import { afterEach, describe, expect, it, vi } from "vitest";
import { TelegramNotifyService } from "./telegram-notify.service";

describe("TelegramNotifyService", () => {
  const originalAdminTelegramChatId = process.env.ADMIN_TELEGRAM_CHAT_ID;
  const originalAdminTelegramUsername = process.env.ADMIN_TELEGRAM_USERNAME;
  const originalTelegramBotToken = process.env.TELEGRAM_BOT_TOKEN;

  afterEach(() => {
    process.env.ADMIN_TELEGRAM_CHAT_ID = originalAdminTelegramChatId;
    process.env.ADMIN_TELEGRAM_USERNAME = originalAdminTelegramUsername;
    process.env.TELEGRAM_BOT_TOKEN = originalTelegramBotToken;
    vi.restoreAllMocks();
  });

  it("does not use ADMIN_TELEGRAM_USERNAME as a private chat fallback for manual order alerts", async () => {
    delete process.env.ADMIN_TELEGRAM_CHAT_ID;
    process.env.ADMIN_TELEGRAM_USERNAME = "vanhdao99";
    delete process.env.TELEGRAM_BOT_TOKEN;

    const service = new TelegramNotifyService();
    const sendMessage = vi.spyOn(service, "sendMessage");
    const warn = vi.spyOn((service as unknown as { logger: { warn: (message: string) => void } }).logger, "warn").mockImplementation(() => undefined);

    await service.notifyAdminManualOrder({
      code: "DHADMIN1",
      productName: "Manual product",
      quantity: 2,
      totalAmount: 20000,
      customerLabel: "web:user@example.com",
      deliveryText: "Lien he Zalo 0377952999 de nhan hang."
    });

    expect(sendMessage).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("ADMIN_TELEGRAM_CHAT_ID missing"));
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("DHADMIN1"));
  });

  it("sends manual order alerts to configured admin chat id", async () => {
    process.env.ADMIN_TELEGRAM_CHAT_ID = "123456789";
    process.env.ADMIN_TELEGRAM_USERNAME = "vanhdao99";
    delete process.env.TELEGRAM_BOT_TOKEN;

    const service = new TelegramNotifyService();
    const sendMessage = vi.spyOn(service, "sendMessage").mockResolvedValue(undefined);

    await service.notifyAdminManualOrder({
      code: "DHADMIN2",
      productName: "Manual product",
      quantity: 1,
      totalAmount: 15000,
      customerLabel: "web:user@example.com"
    });

    expect(sendMessage).toHaveBeenCalledWith("123456789", expect.stringContaining("DHADMIN2"));
    expect(sendMessage).toHaveBeenCalledWith("123456789", expect.stringContaining("Manual product"));
  });
});
