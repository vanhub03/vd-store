import { BadRequestException, Injectable, Logger, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { BroadcastDeliveryStatus, BroadcastStatus } from "@prisma/client";
import { Job, Queue, Worker } from "bullmq";
import IORedis from "ioredis";
import { PrismaService } from "../prisma.service";
import { TelegramNotifyService } from "./telegram-notify.service";

type BroadcastJob = {
  broadcastId: string;
  deliveryId: string;
};

@Injectable()
export class BroadcastService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(BroadcastService.name);
  private connection?: IORedis;
  private queue?: Queue<BroadcastJob>;
  private worker?: Worker<BroadcastJob>;

  constructor(
    private readonly prisma: PrismaService,
    private readonly telegram: TelegramNotifyService
  ) {}

  onModuleInit() {
    const redisUrl = process.env.REDIS_URL;
    if (!redisUrl) {
      this.logger.warn("REDIS_URL missing. Broadcast queue disabled.");
      return;
    }
    this.connection = new IORedis(redisUrl, { maxRetriesPerRequest: null });
    this.queue = new Queue<BroadcastJob>("broadcasts", { connection: this.connection });
    this.worker = new Worker<BroadcastJob>("broadcasts", (job) => this.processDelivery(job), {
      connection: this.connection,
      concurrency: 1
    });
  }

  async onModuleDestroy() {
    await this.worker?.close();
    await this.queue?.close();
    await this.connection?.quit();
  }

  async createBroadcast(adminId: string, title: string, message: string) {
    if (!title.trim() || !message.trim()) {
      throw new BadRequestException("Tiêu đề và nội dung thông báo là bắt buộc.");
    }
    return this.prisma.broadcast.create({
      data: {
        title: title.trim(),
        message: message.trim(),
        createdByAdminId: adminId,
        status: BroadcastStatus.DRAFT
      }
    });
  }

  async listBroadcasts() {
    return this.prisma.broadcast.findMany({
      orderBy: { createdAt: "desc" },
      take: 100,
      include: { createdBy: true }
    });
  }

  async queueBroadcast(broadcastId: string) {
    const broadcast = await this.prisma.broadcast.findUnique({ where: { id: broadcastId } });
    if (!broadcast) throw new BadRequestException("Không tìm thấy thông báo.");
    if (!this.queue) throw new BadRequestException("Broadcast queue chưa sẵn sàng. Kiểm tra REDIS_URL.");

    const users = await this.prisma.telegramUser.findMany({ where: { isBlocked: false } });
    await this.prisma.broadcast.update({
      where: { id: broadcastId },
      data: { status: BroadcastStatus.QUEUED, sentCount: 0, failedCount: 0 }
    });

    for (const user of users) {
      const delivery = await this.prisma.broadcastDelivery.upsert({
        where: { broadcastId_userId: { broadcastId, userId: user.id } },
        update: { status: BroadcastDeliveryStatus.PENDING, error: null, sentAt: null },
        create: { broadcastId, userId: user.id, status: BroadcastDeliveryStatus.PENDING }
      });
      await this.queue.add("send", { broadcastId, deliveryId: delivery.id }, { attempts: 3, backoff: { type: "exponential", delay: 2000 } });
    }

    return { queued: users.length };
  }

  private async processDelivery(job: Job<BroadcastJob>) {
    const delivery = await this.prisma.broadcastDelivery.findUnique({
      where: { id: job.data.deliveryId },
      include: { broadcast: true, user: true }
    });
    if (!delivery || delivery.status !== BroadcastDeliveryStatus.PENDING) return;

    await this.prisma.broadcast.update({
      where: { id: delivery.broadcastId },
      data: { status: BroadcastStatus.SENDING }
    });

    try {
      await this.telegram.sendMessage(delivery.user.telegramId, delivery.broadcast.message);
      await this.prisma.broadcastDelivery.update({
        where: { id: delivery.id },
        data: { status: BroadcastDeliveryStatus.SENT, sentAt: new Date() }
      });
      await this.prisma.broadcast.update({
        where: { id: delivery.broadcastId },
        data: { sentCount: { increment: 1 } }
      });
    } catch (error) {
      await this.prisma.broadcastDelivery.update({
        where: { id: delivery.id },
        data: { status: BroadcastDeliveryStatus.FAILED, error: (error as Error).message }
      });
      await this.prisma.broadcast.update({
        where: { id: delivery.broadcastId },
        data: { failedCount: { increment: 1 } }
      });
      throw error;
    } finally {
      await this.finalizeBroadcastIfDone(delivery.broadcastId);
    }
  }

  private async finalizeBroadcastIfDone(broadcastId: string) {
    const [pending, failed] = await Promise.all([
      this.prisma.broadcastDelivery.count({ where: { broadcastId, status: BroadcastDeliveryStatus.PENDING } }),
      this.prisma.broadcastDelivery.count({ where: { broadcastId, status: BroadcastDeliveryStatus.FAILED } })
    ]);
    if (pending > 0) return;
    await this.prisma.broadcast.update({
      where: { id: broadcastId },
      data: { status: failed > 0 ? BroadcastStatus.PARTIAL : BroadcastStatus.SENT }
    });
  }
}
