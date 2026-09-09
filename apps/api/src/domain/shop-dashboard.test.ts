import { describe, expect, it, vi } from "vitest";
import { ShopService } from "./shop.service";

describe("ShopService dashboard", () => {
  it("returns the top ten customers ranked by successful purchase value", async () => {
    const users = [
      { id: "user-high", telegramId: "100", username: "high", role: "CUSTOMER" },
      { id: "user-next", telegramId: "200", username: "next", role: "COLLABORATOR" }
    ];
    const prisma = {
      payment: {
        findMany: vi.fn().mockResolvedValue([]),
        groupBy: vi.fn().mockResolvedValue([
          { userId: "user-high", _sum: { amount: 900_000 }, _count: { id: 5 } },
          { userId: "user-next", _sum: { amount: 500_000 }, _count: { id: 8 } }
        ])
      },
      walletLedgerEntry: {
        aggregate: vi.fn().mockResolvedValue({ _sum: { amount: 0 } }),
        groupBy: vi.fn().mockResolvedValue([]),
        findMany: vi.fn().mockResolvedValue([])
      },
      order: { findMany: vi.fn().mockResolvedValue([]) },
      telegramUser: { findMany: vi.fn().mockResolvedValue(users) }
    };
    const service = new ShopService(prisma as never, {} as never, {} as never);
    vi.spyOn(service, "getStats").mockResolvedValue({ users: 2, products: 1, orders: 13, pendingPayments: 0, revenue: 1_400_000 });

    const dashboard = await service.getDashboard();

    expect(prisma.payment.groupBy).toHaveBeenCalledWith(expect.objectContaining({
      by: ["userId"],
      take: 10,
      orderBy: { _sum: { amount: "desc" } }
    }));
    expect(dashboard.topCustomers).toEqual([
      { user: users[0], totalSpent: 900_000, purchaseCount: 5 },
      { user: users[1], totalSpent: 500_000, purchaseCount: 8 }
    ]);
  });
});
