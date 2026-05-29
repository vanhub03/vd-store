import { Injectable, Logger } from "@nestjs/common";
import { Telegram } from "telegraf";
import { formatVnd } from "./money";

@Injectable()
export class TelegramNotifyService {
  private readonly logger = new Logger(TelegramNotifyService.name);
  private readonly telegram?: Telegram;

  constructor() {
    const token = process.env.TELEGRAM_BOT_TOKEN;
    if (token) {
      this.telegram = new Telegram(token);
    }
  }

  async sendMessage(chatId: string, message: string) {
    if (!this.telegram) {
      this.logger.warn(`Telegram token missing. Would send to ${chatId}: ${message}`);
      return;
    }

    for (const chunk of splitTelegramMessage(message)) {
      try {
        await this.telegram.sendMessage(chatId, chunk, { parse_mode: "HTML" });
      } catch (error) {
        this.logger.warn(`Could not send Telegram message to ${chatId}: ${(error as Error).message}`);
      }
    }
  }

  async deleteMessage(chatId?: string | null, messageId?: number | null) {
    if (!this.telegram || !chatId || !messageId) return;
    try {
      await this.telegram.deleteMessage(chatId, messageId);
    } catch (error) {
      this.logger.warn(`Could not delete Telegram message ${chatId}/${messageId}: ${(error as Error).message}`);
    }
  }

  async notifyTopup(chatId: string, amount: number, code: string) {
    await this.sendMessage(chatId, `Nạp tiền thành công\nMã: <b>${code}</b>\nSố tiền: <b>${formatVnd(amount)}</b>`);
  }

  async notifyManualReview(chatId: string, code: string) {
    await this.sendMessage(
      chatId,
      `Giao dịch <b>${code}</b> cần admin kiểm tra do số tiền không khớp. Vui lòng liên hệ @${process.env.ADMIN_TELEGRAM_USERNAME ?? "vanhdao99"}.`
    );
  }

  async notifyDirectOrderFulfilled(chatId: string, code: string, deliveryText: string) {
    await this.sendMessage(chatId, `Thanh toán đơn <b>${code}</b> thành công.\n\nHàng của bạn:\n<pre>${escapeHtml(deliveryText)}</pre>`);
  }

  async notifyPaymentCredited(chatId: string, code: string, amount: number, reason: string) {
    await this.sendMessage(
      chatId,
      `Thanh toán <b>${code}</b> đã được cộng vào ví.\nSố tiền: <b>${formatVnd(amount)}</b>\nLý do: ${escapeHtml(reason)}`
    );
  }

  async notifyAdminManualOrder(input: {
    code: string;
    productName: string;
    quantity: number;
    totalAmount: number;
    customerLabel: string;
    deliveryText?: string | null;
  }) {
    const adminChatId = configuredChatId(process.env.ADMIN_TELEGRAM_CHAT_ID);
    const message = [
      "Đơn hàng cần giao thủ công",
      `Mã đơn: <b>${escapeHtml(input.code)}</b>`,
      `Sản phẩm: <b>${escapeHtml(input.productName)}</b>`,
      `Số lượng: <b>${input.quantity}</b>`,
      `Tổng tiền: <b>${formatVnd(input.totalAmount)}</b>`,
      `Khách: ${escapeHtml(input.customerLabel)}`,
      input.deliveryText ? `Ghi chú giao hàng: ${escapeHtml(input.deliveryText)}` : null
    ]
      .filter(Boolean)
      .join("\n");

    if (!adminChatId) {
      this.logger.warn(
        `ADMIN_TELEGRAM_CHAT_ID missing. Manual order remains visible in admin dashboard. Notification payload: ${message}`
      );
      return;
    }
    await this.sendMessage(adminChatId, message);
  }
}

function configuredChatId(chatId?: string) {
  const trimmed = chatId?.trim();
  return trimmed || undefined;
}

function splitTelegramMessage(message: string) {
  const max = 3800;
  const chunks: string[] = [];
  for (let i = 0; i < message.length; i += max) {
    chunks.push(message.slice(i, i + max));
  }
  return chunks.length ? chunks : [message];
}

function escapeHtml(input: string) {
  return input.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
