import { Injectable, Logger } from "@nestjs/common";
import { Cron, CronExpression } from "@nestjs/schedule";
import { ShopService } from "./shop.service";
import { TelegramNotifyService } from "./telegram-notify.service";
import { PrismaService } from "../prisma.service";
import { SoldProductSubscriptionService } from "./sold-product-subscription.service";

@Injectable()
export class TaskService {
  private readonly logger = new Logger(TaskService.name);

  constructor(
    private readonly shop: ShopService,
    private readonly telegram: TelegramNotifyService,
    private readonly prisma: PrismaService,
    private readonly soldSubscriptions: SoldProductSubscriptionService
  ) {}

  @Cron(CronExpression.EVERY_MINUTE)
  async expirePendingPayments() {
    const expired = await this.shop.expirePendingPayments();
    for (const payment of expired) {
      await this.telegram.deleteMessage(payment.telegramChatId, payment.telegramMessageId);
    }
    if (expired.length > 0) {
      this.logger.log(`Expired ${expired.length} pending payment(s).`);
    }
  }

  @Cron(CronExpression.EVERY_HOUR)
  async purgeExpiredPartnerIdempotency() {
    const result = await this.prisma.apiIdempotencyRecord.deleteMany({ where: { expiresAt: { lt: new Date() } } });
    if (result.count > 0) this.logger.log(`Purged ${result.count} expired partner idempotency record(s).`);
  }

  @Cron(CronExpression.EVERY_HOUR)
  async sendDueSoldProductRenewalReminders() {
    await this.soldSubscriptions.dispatchDueRenewalReminders();
  }
}
