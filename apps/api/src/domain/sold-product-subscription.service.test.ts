import { describe, expect, it, vi } from "vitest";
import { SoldProductSubscriptionService } from "./sold-product-subscription.service";

describe("SoldProductSubscriptionService", () => {
  it("calculates expiry by calendar month when creating a sold-product record", async () => {
    const create = vi.fn().mockImplementation(({ data }) => Promise.resolve({ id: "subscription-1", ...data }));
    const prisma = {
      product: { findUnique: vi.fn().mockResolvedValue({ id: "product-1", name: "Canva Pro" }) },
      soldProductSubscription: { create },
      auditLog: { create: vi.fn().mockResolvedValue({}) }
    };
    const service = new SoldProductSubscriptionService(prisma as never, {} as never);

    await service.create("admin-1", {
      productId: "product-1",
      customerName: "Vanh Dao",
      startDate: "2026-01-31",
      durationMonths: 1
    });

    expect(create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        productName: "Canva Pro",
        expiresAt: new Date("2026-02-28T00:00:00.000Z")
      })
    }));
  });

  it("claims a due reminder before sending so a concurrent worker cannot send it twice", async () => {
    const dueSubscription = {
      id: "subscription-1",
      active: true,
      productName: "ChatGPT Plus",
      customerName: "Vanh Dao",
      zaloLink: "https://zalo.me/example",
      accountNote: "chatgpt-account",
      expiresAt: new Date("2026-01-01T00:00:00.000Z")
    };
    const updateMany = vi.fn()
      .mockResolvedValueOnce({ count: 1 })
      .mockResolvedValueOnce({ count: 1 });
    const prisma = {
      soldProductSubscription: {
        findMany: vi.fn().mockResolvedValue([dueSubscription]),
        updateMany
      },
      auditLog: { create: vi.fn().mockResolvedValue({}) }
    };
    const telegram = { notifyAdminSubscriptionRenewal: vi.fn().mockResolvedValue(true) };
    const service = new SoldProductSubscriptionService(prisma as never, telegram as never);

    const result = await service.dispatchDueRenewalReminders();

    expect(telegram.notifyAdminSubscriptionRenewal).toHaveBeenCalledWith(expect.objectContaining({
      productName: "ChatGPT Plus",
      customerName: "Vanh Dao"
    }));
    expect(updateMany).toHaveBeenCalledTimes(2);
    expect(result).toEqual({ checked: 1, sent: 1, failed: 0 });
  });

  it("leaves a failed delivery eligible for an automatic retry", async () => {
    const dueSubscription = {
      id: "subscription-1",
      active: true,
      productName: "ChatGPT Plus",
      customerName: "Vanh Dao",
      zaloLink: null,
      accountNote: null,
      expiresAt: new Date("2026-01-01T00:00:00.000Z")
    };
    const updateMany = vi.fn()
      .mockResolvedValueOnce({ count: 1 })
      .mockResolvedValueOnce({ count: 1 });
    const prisma = {
      soldProductSubscription: {
        findMany: vi.fn().mockResolvedValue([dueSubscription]),
        updateMany
      },
      auditLog: { create: vi.fn().mockResolvedValue({}) }
    };
    const telegram = { notifyAdminSubscriptionRenewal: vi.fn().mockResolvedValue(false) };
    const service = new SoldProductSubscriptionService(prisma as never, telegram as never);

    const result = await service.dispatchDueRenewalReminders();

    expect(updateMany).toHaveBeenLastCalledWith(expect.objectContaining({
      data: { renewalReminderFor: null, renewalReminderClaimedAt: null }
    }));
    expect(result).toEqual({ checked: 1, sent: 0, failed: 1 });
  });
});
