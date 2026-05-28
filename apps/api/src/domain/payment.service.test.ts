import { PaymentKind, PaymentStatus } from "@prisma/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PaymentService } from "./payment.service";

describe("PaymentService", () => {
  const originalSepayAccountNumber = process.env.SEPAY_ACCOUNT_NUMBER;

  afterEach(() => {
    process.env.SEPAY_ACCOUNT_NUMBER = originalSepayAccountNumber;
    vi.restoreAllMocks();
  });

  it("processes Bank Hub credit payloads, deletes the latest QR message, and notifies the user", async () => {
    process.env.SEPAY_ACCOUNT_NUMBER = "03219071601";

    const payment = {
      id: "payment_1",
      code: "NAPABC123",
      kind: PaymentKind.TOPUP,
      status: PaymentStatus.PENDING,
      amount: 2000,
      expectedAmount: 2000,
      telegramChatId: null,
      telegramMessageId: null,
      user: { telegramId: "123456" },
      order: null
    };
    const latestPaymentMessage = {
      telegramChatId: "123456",
      telegramMessageId: 77
    };
    const prisma = {
      bankTransaction: {
        findUnique: vi.fn().mockResolvedValue(null),
        create: vi.fn().mockResolvedValue({ id: "bank_tx_1" }),
        update: vi.fn().mockResolvedValue({})
      },
      payment: {
        findUnique: vi.fn().mockResolvedValueOnce(payment).mockResolvedValueOnce(latestPaymentMessage)
      }
    };
    const shop = {
      creditTopup: vi.fn().mockResolvedValue({ outcome: "credited", user: payment.user })
    };
    const telegram = {
      deleteMessage: vi.fn().mockResolvedValue(undefined),
      notifyTopup: vi.fn().mockResolvedValue(undefined)
    };

    const service = new PaymentService(prisma as never, shop as never, telegram as never);
    const result = await service.handleSepayWebhook({
      transaction_id: "SBTEST123",
      gateway: "TPBank",
      transaction_date: "2026-05-27 22:40:00",
      account_number: "03219071601",
      payment_code: "NAPABC123",
      content: "NAPABC123 nap tien",
      transfer_type: "credit",
      amount: "2000",
      reference_code: "FT123"
    });

    expect(result).toEqual({ ok: true, status: "credited" });
    expect(prisma.payment.findUnique).toHaveBeenNthCalledWith(1, {
      where: { code: "NAPABC123" },
      include: { user: true, order: true }
    });
    expect(shop.creditTopup).toHaveBeenCalledWith("payment_1");
    expect(telegram.deleteMessage).toHaveBeenCalledWith("123456", 77);
    expect(telegram.notifyTopup).toHaveBeenCalledWith("123456", 2000, "NAPABC123");
  });

  it("does not try to send Telegram messages to web-only customers", async () => {
    process.env.SEPAY_ACCOUNT_NUMBER = "03219071601";

    const payment = {
      id: "payment_web_1",
      code: "NAPWEB123",
      kind: PaymentKind.TOPUP,
      status: PaymentStatus.PENDING,
      amount: 2000,
      expectedAmount: 2000,
      telegramChatId: null,
      telegramMessageId: null,
      user: { telegramId: "web:customer-1" },
      order: null
    };
    const prisma = {
      bankTransaction: {
        findUnique: vi.fn().mockResolvedValue(null),
        create: vi.fn().mockResolvedValue({ id: "bank_tx_web_1" }),
        update: vi.fn().mockResolvedValue({})
      },
      payment: {
        findUnique: vi.fn().mockResolvedValueOnce(payment).mockResolvedValueOnce({
          telegramChatId: null,
          telegramMessageId: null
        })
      }
    };
    const shop = {
      creditTopup: vi.fn().mockResolvedValue({ outcome: "credited", user: payment.user })
    };
    const telegram = {
      deleteMessage: vi.fn().mockResolvedValue(undefined),
      notifyTopup: vi.fn().mockResolvedValue(undefined)
    };

    const service = new PaymentService(prisma as never, shop as never, telegram as never);
    const result = await service.handleSepayWebhook({
      id: "WEB123",
      gateway: "TPBank",
      accountNumber: "03219071601",
      content: "NAPWEB123",
      transferType: "in",
      transferAmount: 2000
    });

    expect(result).toEqual({ ok: true, status: "credited" });
    expect(shop.creditTopup).toHaveBeenCalledWith("payment_web_1");
    expect(telegram.notifyTopup).not.toHaveBeenCalled();
  });
});
