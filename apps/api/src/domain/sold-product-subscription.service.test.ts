import { describe, expect, it, vi } from "vitest";
import { ManualOrderStatus, OrderStatus, SalesChannel } from "@prisma/client";
import { SoldProductSubscriptionService } from "./sold-product-subscription.service";

describe("SoldProductSubscriptionService", () => {
  it("automatically tracks a fulfilled website order using its product duration and customer", async () => {
    const order = {
      id: "order-web-1",
      code: "DHWEB001",
      productId: "product-1",
      totalAmount: 250000,
      status: OrderStatus.FULFILLED,
      manualStatus: ManualOrderStatus.PENDING,
      salesChannel: SalesChannel.WEB,
      fulfilledAt: new Date("2026-09-11T04:30:00.000Z"),
      deliveryText: "account@example.com",
      product: { name: "ChatGPT Plus", subscriptionDurationMonths: 3 },
      user: { telegramId: "web:customer-1", displayName: "Nguyễn Văn A" }
    };
    const create = vi.fn().mockImplementation(({ data }) => Promise.resolve({ id: "subscription-auto-1", ...data }));
    const tx = {
      order: { findUnique: vi.fn().mockResolvedValue(order) },
      soldProductSubscription: { findUnique: vi.fn().mockResolvedValue(null), create },
      auditLog: { create: vi.fn().mockResolvedValue({}) }
    };
    const service = new SoldProductSubscriptionService({} as never, {} as never);

    await service.trackOrder(tx as never, order.id);

    expect(create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        sourceOrderId: order.id,
        productId: order.productId,
        productName: "ChatGPT Plus",
        saleAmount: 250000,
        customerName: "Nguyễn Văn A",
        durationMonths: 3,
        startedAt: new Date("2026-09-11T00:00:00.000Z"),
        expiresAt: new Date("2026-12-11T00:00:00.000Z"),
        accountNote: "account@example.com"
      })
    });
  });

  it("does not create a second tracking row when the same order is processed again", async () => {
    const existing = { id: "subscription-existing", sourceOrderId: "order-1" };
    const tx = {
      order: {
        findUnique: vi.fn().mockResolvedValue({
          id: "order-1",
          status: OrderStatus.FULFILLED,
          manualStatus: ManualOrderStatus.PENDING,
          salesChannel: SalesChannel.BOT,
          product: { subscriptionDurationMonths: 1 },
          user: { telegramId: "123" }
        })
      },
      soldProductSubscription: { findUnique: vi.fn().mockResolvedValue(existing), create: vi.fn() },
      auditLog: { create: vi.fn() }
    };
    const service = new SoldProductSubscriptionService({} as never, {} as never);

    expect(await service.trackOrder(tx as never, "order-1")).toBe(existing);
    expect(tx.soldProductSubscription.create).not.toHaveBeenCalled();
  });

  it("keeps Partner API orders out of the website and bot renewal list", async () => {
    const tx = {
      order: {
        findUnique: vi.fn().mockResolvedValue({
          id: "partner-order-1",
          status: OrderStatus.FULFILLED,
          manualStatus: ManualOrderStatus.PENDING,
          salesChannel: SalesChannel.PARTNER_API,
          product: {},
          user: {}
        })
      },
      soldProductSubscription: { findUnique: vi.fn(), create: vi.fn() }
    };
    const service = new SoldProductSubscriptionService({} as never, {} as never);

    expect(await service.trackOrder(tx as never, "partner-order-1")).toBeNull();
    expect(tx.soldProductSubscription.findUnique).not.toHaveBeenCalled();
  });

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
      productName: "Canva Pro",
      saleAmount: 99000,
      customerName: "Vanh Dao",
      startDate: "2026-01-31",
      durationMonths: 1
    });

    expect(create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        productName: "Canva Pro",
        saleAmount: 99000,
        expiresAt: new Date("2026-02-28T00:00:00.000Z")
      })
    }));
  });

  it("rejects a Zalo link that cannot be opened safely from the admin page", async () => {
    const prisma = {
      product: { findUnique: vi.fn().mockResolvedValue({ id: "product-1", name: "Canva Pro" }) },
      soldProductSubscription: { create: vi.fn() },
      auditLog: { create: vi.fn() }
    };
    const service = new SoldProductSubscriptionService(prisma as never, {} as never);

    await expect(service.create("admin-1", {
      productId: "product-1",
      productName: "Canva Pro",
      customerName: "Vanh Dao",
      zaloLink: "javascript:alert(1)",
      startDate: "2026-01-31",
      durationMonths: 1
    })).rejects.toThrow("Link Zalo");
  });

  it("keeps a newly entered product name without creating a catalog product", async () => {
    const create = vi.fn().mockImplementation(({ data }) => Promise.resolve({ id: "subscription-1", ...data }));
    const prisma = {
      product: { findUnique: vi.fn() },
      soldProductSubscription: { create },
      auditLog: { create: vi.fn().mockResolvedValue({}) }
    };
    const service = new SoldProductSubscriptionService(prisma as never, {} as never);

    await service.create("admin-1", {
      productName: "Tài khoản mới bán ngoài",
      saleAmount: 125000,
      customerName: "Vanh Dao",
      startDate: "2026-01-31",
      durationMonths: 1
    });

    expect(prisma.product.findUnique).not.toHaveBeenCalled();
    expect(create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        product: undefined,
        productName: "Tài khoản mới bán ngoài",
        saleAmount: 125000
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
