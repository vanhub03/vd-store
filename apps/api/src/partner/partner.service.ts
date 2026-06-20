import { BadRequestException, HttpException, Injectable, NotFoundException } from "@nestjs/common";
import {
  ApiIdempotencyStatus,
  CustomerRole,
  ManualOrderStatus,
  OrderStatus,
  PartnerEnvironment,
  PartnerOrderItemStatus,
  PartnerOrderStatus,
  Prisma,
  ProductDeliveryType,
  WalletEntryType
} from "@prisma/client";
import crypto from "node:crypto";
import { PrismaService } from "../prisma.service";
import { CartOrderItemInput, ShopService } from "../domain/shop.service";
import { hashApiKey, PartnerApiException, PartnerScopeName } from "./partner-auth.guard";
import { PartnerWebhookService } from "./partner-webhook.service";

const ALL_SCOPES: PartnerScopeName[] = ["catalog:read", "balance:read", "orders:read", "orders:write"];

@Injectable()
export class PartnerService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly shop: ShopService,
    private readonly webhooks: PartnerWebhookService
  ) {}

  async catalog(environment: PartnerEnvironment) {
    const catalog = await this.shop.getCatalog("web", CustomerRole.COLLABORATOR) as {
      categories: Array<{ id: string; name: string; products: Array<Record<string, unknown>> }>;
      uncategorized: Array<Record<string, unknown>>;
    };
    return {
      livemode: environment === PartnerEnvironment.LIVE,
      categories: catalog.categories.map((category) => ({
        id: category.id,
        name: category.name,
        products: category.products.map((product) => publicCatalogProduct(product, environment))
      })),
      uncategorized: catalog.uncategorized.map((product) => publicCatalogProduct(product, environment))
    };
  }

  async balance(userId: string, environment: PartnerEnvironment) {
    return {
      livemode: environment === PartnerEnvironment.LIVE,
      currency: "VND",
      balance: environment === PartnerEnvironment.TEST ? 1_000_000_000 : await this.shop.getWalletBalance(userId)
    };
  }

  async createOrder(input: {
    userId: string;
    environment: PartnerEnvironment;
    idempotencyKey: string;
    externalOrderId: string;
    items: CartOrderItemInput[];
    voucherCode?: string | null;
  }) {
    validateCreateOrder(input);
    const requestHash = stableHash({ externalOrderId: input.externalOrderId, items: input.items, voucherCode: input.voucherCode ?? null });
    const existing = await this.findIdempotency(input.userId, input.environment, input.idempotencyKey);
    if (existing) return this.replayIdempotency(existing, requestHash, input);

    try {
      await this.prisma.apiIdempotencyRecord.create({
        data: {
          userId: input.userId,
          environment: input.environment,
          idempotencyKey: input.idempotencyKey,
          requestHash,
          expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000)
        }
      });
    } catch (error) {
      if (isUniqueViolation(error)) {
        const raced = await this.findIdempotency(input.userId, input.environment, input.idempotencyKey);
        if (raced) return this.replayIdempotency(raced, requestHash, input);
      }
      throw error;
    }

    try {
      const duplicate = await this.prisma.partnerOrder.findUnique({
        where: { userId_environment_externalOrderId: { userId: input.userId, environment: input.environment, externalOrderId: input.externalOrderId } }
      });
      if (duplicate) throw new PartnerApiException(409, "duplicate_external_order", "The externalOrderId already exists.", { orderId: duplicate.id });

      const created = input.environment === PartnerEnvironment.TEST
        ? await this.createSandboxOrder(input)
        : await retrySerializable(() => this.shop.purchasePartnerCart(input.userId, input.externalOrderId, input.items, input.voucherCode));
      const response = publicPartnerOrder(created.partnerOrder, created.balanceAfter);
      await this.prisma.apiIdempotencyRecord.update({
        where: { userId_environment_idempotencyKey: { userId: input.userId, environment: input.environment, idempotencyKey: input.idempotencyKey } },
        data: { status: ApiIdempotencyStatus.COMPLETED, responseStatus: 201, responseBody: response as Prisma.InputJsonValue }
      });
      await this.webhooks.emit(input.userId, input.environment, "order.created", { order: response }, created.partnerOrder.id).catch(() => null);
      return response;
    } catch (error) {
      const failure = isUniqueViolation(error)
        ? new PartnerApiException(409, "duplicate_external_order", "The externalOrderId already exists.")
        : error;
      if (failure instanceof HttpException) {
        const raw = failure.getResponse();
        const errorBody = typeof raw === "object" && raw ? raw as Record<string, unknown> : { detail: String(raw) };
        await this.prisma.apiIdempotencyRecord.updateMany({
          where: { userId: input.userId, environment: input.environment, idempotencyKey: input.idempotencyKey, status: ApiIdempotencyStatus.PENDING },
          data: { status: ApiIdempotencyStatus.COMPLETED, responseStatus: failure.getStatus(), responseBody: errorBody as Prisma.InputJsonValue }
        });
      } else {
        await this.prisma.apiIdempotencyRecord.deleteMany({
          where: { userId: input.userId, environment: input.environment, idempotencyKey: input.idempotencyKey, status: ApiIdempotencyStatus.PENDING }
        });
      }
      throw failure;
    }
  }

  async getOrder(userId: string, environment: PartnerEnvironment, id: string) {
    const order = await this.prisma.partnerOrder.findFirst({
      where: { id, userId, environment },
      include: { items: { orderBy: { createdAt: "asc" } } }
    });
    if (!order) throw new NotFoundException("Partner order not found.");
    return publicPartnerOrder(order);
  }

  async listOrders(userId: string, environment: PartnerEnvironment, cursor?: string, limit = 50) {
    const take = Math.min(100, Math.max(1, Number(limit) || 50));
    if (cursor) {
      const cursorOrder = await this.prisma.partnerOrder.findFirst({ where: { id: cursor, userId, environment }, select: { id: true } });
      if (!cursorOrder) throw new PartnerApiException(400, "invalid_cursor", "The pagination cursor is invalid.");
    }
    const orders = await this.prisma.partnerOrder.findMany({
      where: { userId, environment },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: take + 1,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      include: { items: { orderBy: { createdAt: "asc" } } }
    });
    const hasMore = orders.length > take;
    const data = hasMore ? orders.slice(0, take) : orders;
    return { data: data.map((order) => publicPartnerOrder(order)), hasMore, nextCursor: hasMore ? data[data.length - 1].id : null };
  }

  async createCredential(adminId: string, userId: string, input: { environment: PartnerEnvironment; label?: string; scopes?: string[]; expiresInDays?: number }) {
    const user = await this.requireCollaborator(userId);
    const scopes = (input.scopes?.length ? input.scopes : ALL_SCOPES).filter((scope): scope is PartnerScopeName => ALL_SCOPES.includes(scope as PartnerScopeName));
    if (!scopes.length) throw new BadRequestException("At least one API scope is required.");
    const rawKey = `vd_${input.environment === PartnerEnvironment.LIVE ? "live" : "test"}_${crypto.randomBytes(32).toString("base64url")}`;
    const expiresInDays = Math.min(3650, Math.max(1, input.expiresInDays ?? 365));
    const credential = await this.prisma.partnerApiCredential.create({
      data: {
        userId: user.id,
        createdByAdminId: adminId,
        environment: input.environment,
        label: input.label?.trim().slice(0, 80) || `${input.environment} key`,
        keyPrefix: rawKey.slice(0, 20),
        keyHash: hashApiKey(rawKey),
        scopes,
        expiresAt: new Date(Date.now() + expiresInDays * 24 * 60 * 60 * 1000)
      }
    });
    await this.audit(adminId, "PARTNER_API_KEY_CREATE", "PartnerApiCredential", credential.id, { userId, environment: input.environment, scopes });
    return { credential: publicCredential(credential), secret: rawKey };
  }

  async listCredentials(userId: string) {
    await this.requireCollaborator(userId);
    return this.prisma.partnerApiCredential.findMany({ where: { userId }, orderBy: { createdAt: "desc" } }).then((rows) => rows.map(publicCredential));
  }

  async revokeCredential(adminId: string, userId: string, credentialId: string) {
    const credential = await this.prisma.partnerApiCredential.findFirst({ where: { id: credentialId, userId } });
    if (!credential) throw new NotFoundException("API key not found.");
    const updated = await this.prisma.partnerApiCredential.update({ where: { id: credential.id }, data: { revokedAt: new Date() } });
    await this.audit(adminId, "PARTNER_API_KEY_REVOKE", "PartnerApiCredential", credential.id, { userId });
    return publicCredential(updated);
  }

  async updateApiSettings(adminId: string, userId: string, input: { enabled?: boolean; readRateLimit?: number; writeRateLimit?: number }) {
    await this.requireCollaborator(userId);
    const updated = await this.prisma.telegramUser.update({
      where: { id: userId },
      data: {
        ...(input.enabled !== undefined ? { partnerApiEnabled: Boolean(input.enabled) } : {}),
        ...(input.readRateLimit !== undefined ? { partnerReadRateLimit: boundedRate(input.readRateLimit, 10, 10_000) } : {}),
        ...(input.writeRateLimit !== undefined ? { partnerWriteRateLimit: boundedRate(input.writeRateLimit, 1, 1_000) } : {})
      }
    });
    await this.audit(adminId, "PARTNER_API_SETTINGS_UPDATE", "TelegramUser", userId, input);
    return { enabled: updated.partnerApiEnabled, readRateLimit: updated.partnerReadRateLimit, writeRateLimit: updated.partnerWriteRateLimit };
  }

  async configureWebhook(adminId: string, userId: string, input: { environment: PartnerEnvironment; url: string; enabled?: boolean; events?: string[]; rotateSecret?: boolean }) {
    await this.requireCollaborator(userId);
    const result = await this.webhooks.configure(userId, input.environment, input);
    await this.audit(adminId, "PARTNER_WEBHOOK_UPDATE", "PartnerWebhookEndpoint", result.endpoint.id, { userId, environment: input.environment, url: input.url });
    return result;
  }

  async fulfillItem(adminId: string, itemId: string, action: "COMPLETED" | "CANCELLED", deliveryText?: string) {
    if (action === "COMPLETED" && !deliveryText?.trim()) throw new BadRequestException("Delivery content is required when completing a manual API item.");
    const result = await this.prisma.$transaction(async (tx) => {
      const item = await tx.partnerOrderItem.findUnique({ where: { id: itemId }, include: { partnerOrder: true, product: true, sourceOrder: true } });
      if (!item || item.deliveryType !== ProductDeliveryType.MANUAL) throw new NotFoundException("Pending manual partner item not found.");
      if (item.status !== PartnerOrderItemStatus.PENDING_FULFILLMENT) throw new BadRequestException("This partner item has already been resolved.");
      const now = new Date();
      if (item.partnerOrder.environment === PartnerEnvironment.LIVE && item.sourceOrderId) {
        if (action === "COMPLETED") {
          await tx.order.update({
            where: { id: item.sourceOrderId },
            data: { status: OrderStatus.FULFILLED, manualStatus: ManualOrderStatus.COMPLETED, deliveryText: deliveryText!.trim(), fulfilledAt: now }
          });
        } else {
          await tx.order.update({ where: { id: item.sourceOrderId }, data: { status: OrderStatus.CANCELLED, manualStatus: ManualOrderStatus.CANCELLED } });
          await tx.product.update({ where: { id: item.productId }, data: { manualStock: { increment: item.quantity } } });
          await tx.walletLedgerEntry.create({
            data: { userId: item.partnerOrder.userId, amount: item.totalAmount, type: WalletEntryType.REFUND, referenceOrderId: item.sourceOrderId, note: `Refund partner item ${item.id}` }
          });
        }
      }
      await tx.partnerOrderItem.update({
        where: { id: item.id },
        data: {
          status: action === "COMPLETED" ? PartnerOrderItemStatus.FULFILLED : PartnerOrderItemStatus.CANCELLED,
          deliveryText: action === "COMPLETED" ? deliveryText!.trim() : null,
          refundedAt: action === "CANCELLED" && item.partnerOrder.environment === PartnerEnvironment.LIVE ? now : null
        }
      });
      const items = await tx.partnerOrderItem.findMany({ where: { partnerOrderId: item.partnerOrderId }, orderBy: { createdAt: "asc" } });
      const status = aggregateStatus(items.map((entry) => entry.status));
      const refundedAmount = items.reduce((sum, entry) => sum + (entry.refundedAt ? entry.totalAmount : 0), 0);
      if (status === PartnerOrderStatus.CANCELLED && item.partnerOrder.environment === PartnerEnvironment.LIVE) {
        const firstSourceOrderId = items.find((entry) => entry.sourceOrderId)?.sourceOrderId;
        if (firstSourceOrderId) {
          const redemption = await tx.voucherRedemption.findUnique({ where: { orderId: firstSourceOrderId }, select: { id: true, voucherId: true, userId: true } });
          if (redemption) {
            await tx.voucherRedemption.delete({ where: { id: redemption.id } });
            await tx.voucher.updateMany({ where: { id: redemption.voucherId, usedCount: { gt: 0 } }, data: { usedCount: { decrement: 1 } } });
            await tx.voucherAssignment.updateMany({ where: { voucherId: redemption.voucherId, userId: redemption.userId, revokedAt: null }, data: { usedAt: null } });
          }
        }
      }
      const order = await tx.partnerOrder.update({ where: { id: item.partnerOrderId }, data: { status, refundedAmount }, include: { items: { orderBy: { createdAt: "asc" } } } });
      await tx.auditLog.create({
        data: { actorAdminId: adminId, action: action === "COMPLETED" ? "PARTNER_ITEM_FULFILL" : "PARTNER_ITEM_CANCEL", entityType: "PartnerOrderItem", entityId: item.id, meta: { partnerOrderId: item.partnerOrderId } }
      });
      return order;
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, timeout: 30_000, maxWait: 10_000 });

    const response = publicPartnerOrder(result);
    await this.webhooks.emit(result.userId, result.environment, "order.updated", { order: response }, result.id).catch(() => null);
    return response;
  }

  private async createSandboxOrder(input: { userId: string; externalOrderId: string; items: CartOrderItemInput[]; voucherCode?: string | null }) {
    const preview = await this.shop.previewPartnerCart(input.userId, input.items, input.voucherCode);
    const itemStatuses = preview.lines.map((line) => line.product.deliveryType === ProductDeliveryType.MANUAL ? PartnerOrderItemStatus.PENDING_FULFILLMENT : PartnerOrderItemStatus.FULFILLED);
    const order = await this.prisma.partnerOrder.create({
      data: {
        userId: input.userId,
        environment: PartnerEnvironment.TEST,
        externalOrderId: input.externalOrderId,
        status: aggregateStatus(itemStatuses),
        subtotalAmount: preview.quote.subtotalAmount,
        collaboratorDiscountAmount: preview.quote.collaboratorDiscountAmount,
        voucherDiscountAmount: preview.quote.voucherDiscountAmount,
        totalAmount: preview.quote.totalAmount,
        voucherCode: preview.quote.code,
        items: {
          create: preview.lines.map((line, index) => ({
            productId: line.product.id,
            productName: line.product.name,
            deliveryType: line.product.deliveryType,
            quantity: line.quantity,
            unitPrice: line.unitPrice,
            subtotalAmount: line.subtotalAmount,
            collaboratorDiscountAmount: line.collaboratorDiscountAmount,
            voucherDiscountAmount: line.voucherDiscountAmount,
            totalAmount: line.totalAmount,
            status: itemStatuses[index],
            deliveryText: itemStatuses[index] === PartnerOrderItemStatus.FULFILLED ? `TEST_DELIVERY_${crypto.randomBytes(12).toString("hex")}` : null
          }))
        }
      },
      include: { items: { orderBy: { createdAt: "asc" } } }
    });
    return { partnerOrder: order, balanceAfter: 1_000_000_000 - order.totalAmount };
  }

  private async findIdempotency(userId: string, environment: PartnerEnvironment, idempotencyKey: string) {
    const record = await this.prisma.apiIdempotencyRecord.findUnique({ where: { userId_environment_idempotencyKey: { userId, environment, idempotencyKey } } });
    if (record?.expiresAt && record.expiresAt <= new Date()) {
      await this.prisma.apiIdempotencyRecord.delete({ where: { id: record.id } });
      return null;
    }
    return record;
  }

  private async replayIdempotency(
    record: { id: string; requestHash: string; status: ApiIdempotencyStatus; responseStatus: number | null; responseBody: Prisma.JsonValue | null },
    requestHash: string,
    input: { userId: string; environment: PartnerEnvironment; externalOrderId: string }
  ) {
    if (record.requestHash !== requestHash) throw new PartnerApiException(409, "idempotency_conflict", "The Idempotency-Key was already used with a different payload.");
    if (record.status !== ApiIdempotencyStatus.COMPLETED || !record.responseBody) {
      const recovered = await this.prisma.partnerOrder.findUnique({
        where: { userId_environment_externalOrderId: { userId: input.userId, environment: input.environment, externalOrderId: input.externalOrderId } },
        include: { items: { orderBy: { createdAt: "asc" } } }
      });
      if (!recovered) throw new PartnerApiException(409, "request_in_progress", "A request with this Idempotency-Key is still in progress.");
      const response = publicPartnerOrder(recovered, input.environment === PartnerEnvironment.TEST ? 1_000_000_000 - recovered.totalAmount : await this.shop.getWalletBalance(input.userId));
      await this.prisma.apiIdempotencyRecord.update({
        where: { id: record.id },
        data: { status: ApiIdempotencyStatus.COMPLETED, responseStatus: 201, responseBody: response as Prisma.InputJsonValue }
      });
      return response;
    }
    if ((record.responseStatus ?? 200) >= 400) {
      const body = record.responseBody as Record<string, unknown>;
      throw new PartnerApiException(record.responseStatus ?? 400, String(body.code ?? "request_failed"), String(body.detail ?? body.message ?? "The original request failed."));
    }
    return record.responseBody;
  }

  private async requireCollaborator(userId: string) {
    const user = await this.prisma.telegramUser.findUnique({ where: { id: userId } });
    if (!user || user.role !== CustomerRole.COLLABORATOR) throw new NotFoundException("Collaborator not found.");
    return user;
  }

  private audit(adminId: string, action: string, entityType: string, entityId: string, meta: Record<string, unknown>) {
    return this.prisma.auditLog.create({ data: { actorAdminId: adminId, action, entityType, entityId, meta: meta as Prisma.InputJsonValue } });
  }
}

function publicPartnerOrder(order: {
  id: string;
  environment: PartnerEnvironment;
  externalOrderId: string;
  status: PartnerOrderStatus;
  currency: string;
  subtotalAmount: number;
  collaboratorDiscountAmount: number;
  voucherDiscountAmount: number;
  totalAmount: number;
  refundedAmount: number;
  voucherCode: string | null;
  createdAt: Date;
  updatedAt: Date;
  items: Array<{
    id: string;
    productId: string;
    productName: string;
    deliveryType: ProductDeliveryType;
    quantity: number;
    unitPrice: number;
    subtotalAmount: number;
    collaboratorDiscountAmount: number;
    voucherDiscountAmount: number;
    totalAmount: number;
    status: PartnerOrderItemStatus;
    deliveryText: string | null;
  }>;
}, balanceAfter?: number) {
  return {
    id: order.id,
    livemode: order.environment === PartnerEnvironment.LIVE,
    externalOrderId: order.externalOrderId,
    status: order.status,
    currency: order.currency,
    subtotalAmount: order.subtotalAmount,
    collaboratorDiscountAmount: order.collaboratorDiscountAmount,
    voucherDiscountAmount: order.voucherDiscountAmount,
    totalAmount: order.totalAmount,
    refundedAmount: order.refundedAmount,
    voucherCode: order.voucherCode,
    ...(balanceAfter !== undefined ? { balanceAfter } : {}),
    items: order.items.map((item) => ({
      id: item.id,
      productId: item.productId,
      productName: item.productName,
      deliveryType: item.deliveryType,
      quantity: item.quantity,
      unitPrice: item.unitPrice,
      subtotalAmount: item.subtotalAmount,
      collaboratorDiscountAmount: item.collaboratorDiscountAmount,
      voucherDiscountAmount: item.voucherDiscountAmount,
      totalAmount: item.totalAmount,
      status: item.status,
      delivery: item.status === PartnerOrderItemStatus.FULFILLED ? { content: item.deliveryText } : null
    })),
    createdAt: order.createdAt.toISOString(),
    updatedAt: order.updatedAt.toISOString()
  };
}

function publicCatalogProduct(product: Record<string, unknown>, environment: PartnerEnvironment) {
  const count = product._count as { inventoryItems?: number } | undefined;
  const deliveryType = String(product.deliveryType);
  const availableQuantity = environment === PartnerEnvironment.TEST ? 999 : deliveryType === ProductDeliveryType.STOCK_ITEM ? count?.inventoryItems ?? 0 : deliveryType === ProductDeliveryType.MANUAL ? Number(product.manualStock ?? 0) : null;
  return {
    id: product.id,
    name: product.name,
    nameEn: product.nameEn,
    description: product.description,
    price: product.price,
    regularPrice: product.regularPrice,
    collaboratorDiscountPercent: product.collaboratorDiscountPercent,
    deliveryType,
    available: availableQuantity === null || availableQuantity > 0,
    availableQuantity
  };
}

function publicCredential(credential: { id: string; environment: PartnerEnvironment; label: string; keyPrefix: string; scopes: string[]; expiresAt: Date | null; revokedAt: Date | null; lastUsedAt: Date | null; createdAt: Date }) {
  return { id: credential.id, environment: credential.environment, label: credential.label, keyPrefix: credential.keyPrefix, scopes: credential.scopes, expiresAt: credential.expiresAt, revokedAt: credential.revokedAt, lastUsedAt: credential.lastUsedAt, createdAt: credential.createdAt };
}

function validateCreateOrder(input: { idempotencyKey: string; externalOrderId: string; items: CartOrderItemInput[] }) {
  if (!input.idempotencyKey || input.idempotencyKey.length < 8 || input.idempotencyKey.length > 255) throw new PartnerApiException(400, "invalid_idempotency_key", "Idempotency-Key must contain 8 to 255 characters.");
  if (!input.externalOrderId?.trim() || input.externalOrderId.length > 100) throw new PartnerApiException(400, "invalid_external_order_id", "externalOrderId is required and must not exceed 100 characters.");
  if (!Array.isArray(input.items) || input.items.length < 1 || input.items.length > 20) throw new PartnerApiException(400, "invalid_items", "items must contain between 1 and 20 entries.");
}

function stableHash(value: unknown) {
  return crypto.createHash("sha256").update(JSON.stringify(sortValue(value))).digest("hex");
}

function sortValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortValue);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)).map(([key, entry]) => [key, sortValue(entry)]));
  return value;
}

function aggregateStatus(statuses: PartnerOrderItemStatus[]) {
  const fulfilled = statuses.filter((status) => status === PartnerOrderItemStatus.FULFILLED).length;
  const cancelled = statuses.filter((status) => status === PartnerOrderItemStatus.CANCELLED).length;
  const pending = statuses.length - fulfilled - cancelled;
  if (cancelled === statuses.length) return PartnerOrderStatus.CANCELLED;
  if (fulfilled === statuses.length) return PartnerOrderStatus.FULFILLED;
  if (cancelled > 0 && pending === 0) return PartnerOrderStatus.PARTIALLY_CANCELLED;
  if (fulfilled > 0 || cancelled > 0) return PartnerOrderStatus.PARTIALLY_FULFILLED;
  return PartnerOrderStatus.PENDING_FULFILLMENT;
}

function boundedRate(value: number, min: number, max: number) {
  const rate = Number(value);
  if (!Number.isInteger(rate) || rate < min || rate > max) throw new BadRequestException(`Rate limit must be an integer between ${min} and ${max}.`);
  return rate;
}

function isUniqueViolation(error: unknown) {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
}

async function retrySerializable<T>(operation: () => Promise<T>) {
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== "P2034" || attempt === 3) throw error;
    }
  }
  throw new Error("Serializable transaction retry exhausted.");
}
