import { BadRequestException, Injectable, Logger, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { Cron, CronExpression } from "@nestjs/schedule";
import { PartnerEnvironment, PartnerWebhookDeliveryStatus, Prisma } from "@prisma/client";
import { Job, Queue, Worker } from "bullmq";
import crypto from "node:crypto";
import dns from "node:dns/promises";
import net from "node:net";
import IORedis from "ioredis";
import { PrismaService } from "../prisma.service";

type WebhookJob = { deliveryId: string };
const WEBHOOK_EVENTS = ["order.created", "order.updated", "webhook.test"];

@Injectable()
export class PartnerWebhookService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PartnerWebhookService.name);
  private connection?: IORedis;
  private queue?: Queue<WebhookJob>;
  private worker?: Worker<WebhookJob>;

  constructor(private readonly prisma: PrismaService) {}

  onModuleInit() {
    if (!process.env.REDIS_URL) return;
    this.connection = new IORedis(process.env.REDIS_URL, { maxRetriesPerRequest: null });
    this.queue = new Queue<WebhookJob>("partner-webhooks", { connection: this.connection });
    this.worker = new Worker<WebhookJob>("partner-webhooks", (job) => this.processDelivery(job.data.deliveryId), {
      connection: this.connection,
      concurrency: Number(process.env.PARTNER_WEBHOOK_CONCURRENCY ?? 5)
    });
    this.worker.on("error", (error) => this.logger.error(`Partner webhook worker error: ${error.message}`));
  }

  async onModuleDestroy() {
    await this.worker?.close();
    await this.queue?.close();
    await this.connection?.quit();
  }

  async configure(userId: string, environment: PartnerEnvironment, input: { url: string; enabled?: boolean; events?: string[]; rotateSecret?: boolean }) {
    await assertPublicWebhookUrl(input.url);
    const events = (input.events?.length ? input.events : WEBHOOK_EVENTS).filter((event) => WEBHOOK_EVENTS.includes(event));
    if (!events.length) throw new BadRequestException("At least one webhook event is required.");
    const existing = await this.prisma.partnerWebhookEndpoint.findUnique({ where: { userId_environment: { userId, environment } } });
    const shouldRotate = !existing || input.rotateSecret;
    const secret = shouldRotate ? `whsec_${crypto.randomBytes(32).toString("base64url")}` : null;
    const encrypted = secret ? encryptSecret(secret) : null;
    const endpoint = await this.prisma.partnerWebhookEndpoint.upsert({
      where: { userId_environment: { userId, environment } },
      update: {
        url: input.url.trim(),
        enabled: input.enabled ?? true,
        events,
        ...(encrypted ? encrypted : {})
      },
      create: {
        userId,
        environment,
        url: input.url.trim(),
        enabled: input.enabled ?? true,
        events,
        ...(encrypted ?? encryptSecret(`whsec_${crypto.randomBytes(32).toString("base64url")}`))
      }
    });
    return { endpoint: publicEndpoint(endpoint), secret };
  }

  listEndpoints(userId: string) {
    return this.prisma.partnerWebhookEndpoint.findMany({ where: { userId }, orderBy: { environment: "asc" } }).then((rows) => rows.map(publicEndpoint));
  }

  listDeliveries(userId: string, take = 50) {
    return this.prisma.partnerWebhookDelivery.findMany({
      where: { event: { endpoint: { userId } } },
      include: { event: { select: { id: true, type: true, createdAt: true, endpoint: { select: { environment: true } } } } },
      orderBy: { createdAt: "desc" },
      take: Math.min(100, Math.max(1, take))
    });
  }

  async emit(userId: string, environment: PartnerEnvironment, type: string, data: Record<string, unknown>, partnerOrderId?: string | null) {
    const endpoint = await this.prisma.partnerWebhookEndpoint.findUnique({ where: { userId_environment: { userId, environment } } });
    if (!endpoint?.enabled || !endpoint.events.includes(type)) return null;
    const eventId = `evt_${crypto.randomUUID().replace(/-/g, "")}`;
    const createdAt = new Date();
    const payload = { id: eventId, type, createdAt: createdAt.toISOString(), livemode: environment === PartnerEnvironment.LIVE, data };
    const event = await this.prisma.partnerWebhookEvent.create({
      data: {
        id: eventId,
        endpointId: endpoint.id,
        partnerOrderId: partnerOrderId ?? null,
        type,
        payload: payload as Prisma.InputJsonValue,
        delivery: { create: { status: PartnerWebhookDeliveryStatus.PENDING, nextAttemptAt: new Date() } }
      },
      include: { delivery: true }
    });
    if (event.delivery) await this.enqueue(event.delivery.id);
    return eventId;
  }

  sendTest(userId: string, environment: PartnerEnvironment) {
    return this.emit(userId, environment, "webhook.test", { message: "VD Store partner webhook test" });
  }

  @Cron(CronExpression.EVERY_MINUTE)
  async recoverPendingDeliveries() {
    const pending = await this.prisma.partnerWebhookDelivery.findMany({
      where: { status: PartnerWebhookDeliveryStatus.PENDING, nextAttemptAt: { lte: new Date() } },
      select: { id: true },
      take: 100
    });
    for (const delivery of pending) await this.enqueue(delivery.id);
  }

  private async enqueue(deliveryId: string) {
    if (this.queue) {
      await this.queue.add("deliver", { deliveryId }, {
        jobId: `${deliveryId}-${Date.now()}`,
        attempts: 8,
        backoff: { type: "exponential", delay: 60_000 },
        removeOnComplete: 1000,
        removeOnFail: 1000
      });
      return;
    }
    void this.processDelivery(deliveryId).catch((error) => this.logger.warn(`Partner webhook delivery deferred: ${safeError(error)}`));
  }

  private async processDelivery(deliveryId: string) {
    const delivery = await this.prisma.partnerWebhookDelivery.findUnique({
      where: { id: deliveryId },
      include: { event: { include: { endpoint: true } } }
    });
    if (!delivery || delivery.status === PartnerWebhookDeliveryStatus.DELIVERED || !delivery.event.endpoint.enabled) return;
    const endpoint = delivery.event.endpoint;
    await assertPublicWebhookUrl(endpoint.url);
    const payload = JSON.stringify(delivery.event.payload);
    const timestamp = Math.floor(Date.now() / 1000);
    const secret = decryptSecret(endpoint);
    const signature = signPartnerWebhook(payload, timestamp, secret);
    try {
      const response = await fetch(endpoint.url, {
        method: "POST",
        redirect: "manual",
        signal: AbortSignal.timeout(10_000),
        headers: {
          "content-type": "application/json",
          "user-agent": "VD-Store-Partner-Webhook/1.0",
          "vd-event-id": delivery.event.id,
          "vd-signature": `t=${timestamp},v1=${signature}`
        },
        body: payload
      });
      if (response.status < 200 || response.status >= 300) throw new Error(`HTTP ${response.status}`);
      await this.prisma.partnerWebhookDelivery.update({
        where: { id: delivery.id },
        data: { status: PartnerWebhookDeliveryStatus.DELIVERED, attemptCount: { increment: 1 }, responseStatus: response.status, deliveredAt: new Date(), nextAttemptAt: null, lastError: null }
      });
    } catch (error) {
      const attempt = delivery.attemptCount + 1;
      const exhausted = attempt >= 8 || Date.now() - delivery.createdAt.getTime() >= 24 * 60 * 60 * 1000;
      await this.prisma.partnerWebhookDelivery.update({
        where: { id: delivery.id },
        data: {
          status: exhausted ? PartnerWebhookDeliveryStatus.FAILED : PartnerWebhookDeliveryStatus.PENDING,
          attemptCount: attempt,
          lastError: safeError(error).slice(0, 500),
          nextAttemptAt: exhausted ? null : new Date(Date.now() + Math.min(6 * 60 * 60 * 1000, 60_000 * 2 ** Math.min(attempt, 8)))
        }
      });
      throw error;
    }
  }
}

function publicEndpoint(endpoint: { id: string; environment: PartnerEnvironment; url: string; enabled: boolean; events: string[]; createdAt: Date; updatedAt: Date }) {
  return { id: endpoint.id, environment: endpoint.environment, url: endpoint.url, enabled: endpoint.enabled, events: endpoint.events, createdAt: endpoint.createdAt, updatedAt: endpoint.updatedAt };
}

function encryptionKey() {
  const secret = process.env.PARTNER_WEBHOOK_ENCRYPTION_KEY ?? process.env.JWT_SECRET;
  if (!secret && process.env.NODE_ENV === "production") throw new Error("PARTNER_WEBHOOK_ENCRYPTION_KEY is required in production.");
  return crypto.createHash("sha256").update(secret ?? "dev-secret").digest();
}

function encryptSecret(secret: string) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", encryptionKey(), iv);
  const encrypted = Buffer.concat([cipher.update(secret, "utf8"), cipher.final()]);
  return { secretCiphertext: encrypted.toString("base64"), secretIv: iv.toString("base64"), secretTag: cipher.getAuthTag().toString("base64") };
}

function decryptSecret(endpoint: { secretCiphertext: string; secretIv: string; secretTag: string }) {
  const decipher = crypto.createDecipheriv("aes-256-gcm", encryptionKey(), Buffer.from(endpoint.secretIv, "base64"));
  decipher.setAuthTag(Buffer.from(endpoint.secretTag, "base64"));
  return Buffer.concat([decipher.update(Buffer.from(endpoint.secretCiphertext, "base64")), decipher.final()]).toString("utf8");
}

async function assertPublicWebhookUrl(rawUrl: string) {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new BadRequestException("Webhook URL is invalid.");
  }
  const localDev = process.env.NODE_ENV !== "production" && ["localhost", "127.0.0.1", "::1"].includes(url.hostname);
  if (url.protocol !== "https:" && !(localDev && url.protocol === "http:")) throw new BadRequestException("Webhook URL must use HTTPS.");
  if (url.username || url.password) throw new BadRequestException("Webhook URL must not contain credentials.");
  if (!localDev) {
    const addresses = await dns.lookup(url.hostname, { all: true });
    if (!addresses.length || addresses.some(({ address }) => isPrivateAddress(address))) throw new BadRequestException("Webhook URL must resolve to a public address.");
  }
}

function isPrivateAddress(address: string) {
  if (net.isIPv4(address)) {
    const [a, b] = address.split(".").map(Number);
    return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || a >= 224;
  }
  const normalized = address.toLowerCase();
  return normalized === "::1" || normalized === "::" || normalized.startsWith("fc") || normalized.startsWith("fd") || normalized.startsWith("fe8") || normalized.startsWith("fe9") || normalized.startsWith("fea") || normalized.startsWith("feb");
}

function safeError(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

export function signPartnerWebhook(rawBody: string, timestamp: number, secret: string) {
  return crypto.createHmac("sha256", secret).update(`${timestamp}.${rawBody}`).digest("hex");
}
