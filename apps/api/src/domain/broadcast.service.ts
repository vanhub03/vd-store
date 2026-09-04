import { BadRequestException, Injectable, Logger, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { BroadcastDeliveryStatus, BroadcastStatus } from "@prisma/client";
import { Job, Queue, Worker } from "bullmq";
import IORedis from "ioredis";
import { PrismaService } from "../prisma.service";
import { TelegramNotifyService } from "./telegram-notify.service";

const MAX_BROADCAST_IMAGE_BYTES = 2 * 1024 * 1024;
const MAX_PHOTO_CAPTION_CHARACTERS = 1024;

export type BroadcastImageUpload = {
  buffer: Buffer;
  mimetype: string;
  originalname: string;
  size: number;
};

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

  async createBroadcast(adminId: string, title: string, message: string, image?: BroadcastImageUpload) {
    const normalizedTitle = title?.trim();
    const normalizedMessage = message?.trim();
    if (!normalizedTitle || !normalizedMessage) {
      throw new BadRequestException("Tiêu đề và nội dung thông báo là bắt buộc.");
    }
    const normalizedImage = normalizeBroadcastImage(image);
    if (normalizedImage && normalizedMessage.length > MAX_PHOTO_CAPTION_CHARACTERS) {
      throw new BadRequestException(`Thông báo có ảnh tối đa ${MAX_PHOTO_CAPTION_CHARACTERS} ký tự để Telegram gửi ảnh và caption trong cùng một tin nhắn.`);
    }
    return this.prisma.broadcast.create({
      data: {
        title: normalizedTitle,
        message: normalizedMessage,
        imageData: normalizedImage?.data,
        imageMimeType: normalizedImage?.mimeType,
        imageFileName: normalizedImage?.fileName,
        createdByAdminId: adminId,
        status: BroadcastStatus.DRAFT
      }
    });
  }

  async createSystemBroadcast(title: string, message: string, adminId?: string) {
    if (!title.trim() || !message.trim()) {
      throw new BadRequestException("Tiêu đề và nội dung thông báo là bắt buộc.");
    }

    const broadcast = await this.prisma.broadcast.create({
      data: {
        title: title.trim(),
        message: message.trim(),
        createdByAdminId: adminId,
        status: BroadcastStatus.DRAFT
      }
    });

    if (!this.queue) {
      this.logger.warn(`Broadcast queue not ready. System broadcast ${broadcast.id} was saved as draft.`);
      return { broadcast, queued: 0 };
    }

    const result = await this.queueBroadcast(broadcast.id);
    return { broadcast, ...result };
  }

  async listBroadcasts() {
    const broadcasts = await this.prisma.broadcast.findMany({
      orderBy: { createdAt: "desc" },
      take: 100,
      select: {
        id: true,
        title: true,
        message: true,
        imageMimeType: true,
        status: true,
        sentCount: true,
        failedCount: true,
        createdAt: true
      }
    });
    return broadcasts.map(({ imageMimeType, ...broadcast }) => ({ ...broadcast, hasImage: Boolean(imageMimeType) }));
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
      const delivered = delivery.broadcast.imageData && delivery.broadcast.imageMimeType && delivery.broadcast.imageFileName
        ? await this.telegram.sendPhotoWithCaption(
            delivery.user.telegramId,
            { data: Buffer.from(delivery.broadcast.imageData), fileName: delivery.broadcast.imageFileName },
            delivery.broadcast.message
          )
        : await this.telegram.sendMessage(delivery.user.telegramId, delivery.broadcast.message);
      if (!delivered) throw new Error("Telegram rejected the broadcast delivery.");
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

function normalizeBroadcastImage(image?: BroadcastImageUpload) {
  if (!image) return undefined;
  if (!Buffer.isBuffer(image.buffer) || image.size <= 0 || image.buffer.length === 0) {
    throw new BadRequestException("Ảnh thông báo không hợp lệ.");
  }
  if (image.size > MAX_BROADCAST_IMAGE_BYTES || image.buffer.length > MAX_BROADCAST_IMAGE_BYTES) {
    throw new BadRequestException("Ảnh thông báo tối đa 2 MB.");
  }

  const detected = detectImageType(image.buffer);
  if (!detected) {
    throw new BadRequestException("Chỉ hỗ trợ ảnh PNG, JPEG hoặc WebP.");
  }
  return {
    data: Buffer.from(image.buffer),
    mimeType: detected.mimeType,
    fileName: `broadcast.${detected.extension}`
  };
}

function detectImageType(buffer: Buffer): { mimeType: string; extension: string } | undefined {
  if (buffer.length >= 8 && buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
    return { mimeType: "image/png", extension: "png" };
  }
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return { mimeType: "image/jpeg", extension: "jpg" };
  }
  if (buffer.length >= 12 && buffer.subarray(0, 4).toString("ascii") === "RIFF" && buffer.subarray(8, 12).toString("ascii") === "WEBP") {
    return { mimeType: "image/webp", extension: "webp" };
  }
  return undefined;
}
