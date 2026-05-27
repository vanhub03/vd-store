import { Injectable, Logger } from "@nestjs/common";
import { Cron, CronExpression } from "@nestjs/schedule";
import { ShopService } from "./shop.service";
import { TelegramNotifyService } from "./telegram-notify.service";

@Injectable()
export class TaskService {
  private readonly logger = new Logger(TaskService.name);

  constructor(
    private readonly shop: ShopService,
    private readonly telegram: TelegramNotifyService
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
}
