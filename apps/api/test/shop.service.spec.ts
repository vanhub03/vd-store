import {
  InventoryStatus,
  OrderStatus,
  PaymentKind,
  PaymentMethod,
  PaymentStatus,
  ProductDeliveryType,
  ProductStatus,
  WalletEntryType
} from "@prisma/client";
import { describe, expect, it, vi } from "vitest";
import { ShopService } from "../src/domain/shop.service";

describe("ShopService", () => {
  it("fulfills manual web wallet purchases by debiting wallet, reducing manual stock, and returning instructions", async () => {
    const user = { id: "user_1", telegramId: "web:customer_1" };
    const product = {
      id: "product_manual_1",
      name: "Manual service",
      price: 15000,
      webPrice: 12000,
      botPrice: 10000,
      showInWeb: true,
      showInBot: true,
      status: ProductStatus.ACTIVE,
      deliveryType: ProductDeliveryType.MANUAL,
      manualStock: 5,
      manualInstructions: "Lien he Zalo 0377952999 de nhan hang."
    };
    const tx = buildPurchaseTx({
      user,
      product,
      balance: 50000,
      orderId: "order_manual_1",
      paymentId: "payment_manual_1"
    });
    const prisma = {
      $transaction: vi.fn(async (callback) => callback(tx))
    };
    const service = new ShopService(prisma as never, {} as never, {} as never);
    const notifyManualOrderIfNeeded = vi.spyOn(service, "notifyManualOrderIfNeeded").mockResolvedValue(undefined);

    const result = await service.purchaseWithWallet("web:customer_1", "product_manual_1", 2, "web");

    expect(result.deliveryText).toBe("Lien he Zalo 0377952999 de nhan hang.");
    expect(result.balanceAfter).toBe(26000);
    expect(tx.order.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        userId: "user_1",
        productId: "product_manual_1",
        quantity: 2,
        unitPrice: 12000,
        totalAmount: 24000,
        status: OrderStatus.PAID,
        paymentMethod: PaymentMethod.WALLET
      })
    });
    expect(tx.payment.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        kind: PaymentKind.WALLET_PURCHASE,
        status: PaymentStatus.SUCCEEDED,
        amount: 24000,
        expectedAmount: 24000,
        userId: "user_1",
        orderId: "order_manual_1"
      })
    });
    expect(tx.walletLedgerEntry.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        userId: "user_1",
        amount: -24000,
        type: WalletEntryType.PURCHASE,
        referencePaymentId: "payment_manual_1",
        referenceOrderId: "order_manual_1"
      })
    });
    expect(tx.product.updateMany).toHaveBeenCalledWith({
      where: { id: "product_manual_1", manualStock: { gte: 2 } },
      data: { manualStock: { decrement: 2 } }
    });
    expect(tx.order.update).toHaveBeenCalledWith({
      where: { id: "order_manual_1" },
      data: expect.objectContaining({
        status: OrderStatus.FULFILLED,
        deliveryText: "Lien he Zalo 0377952999 de nhan hang."
      })
    });
    expect(notifyManualOrderIfNeeded).toHaveBeenCalledWith("order_manual_1");
  });

  it("fulfills stock-item web wallet purchases by selling inventory lines and returning their content", async () => {
    const user = { id: "user_2", telegramId: "web:customer_2" };
    const product = {
      id: "product_stock_1",
      name: "Ready account",
      price: 10000,
      webPrice: 9000,
      botPrice: 8000,
      showInWeb: true,
      showInBot: true,
      status: ProductStatus.ACTIVE,
      deliveryType: ProductDeliveryType.STOCK_ITEM
    };
    const tx = buildPurchaseTx({
      user,
      product,
      balance: 30000,
      orderId: "order_stock_1",
      paymentId: "payment_stock_1",
      inventoryItems: [
        { id: "inv_1", content: "account-1" },
        { id: "inv_2", content: "account-2" }
      ]
    });
    const prisma = {
      $transaction: vi.fn(async (callback) => callback(tx))
    };
    const service = new ShopService(prisma as never, {} as never, {} as never);
    const notifyManualOrderIfNeeded = vi.spyOn(service, "notifyManualOrderIfNeeded").mockResolvedValue(undefined);

    const result = await service.purchaseWithWallet("web:customer_2", "product_stock_1", 2, "web");

    expect(result.deliveryText).toBe("account-1\naccount-2");
    expect(result.balanceAfter).toBe(12000);
    expect(tx.inventoryItem.count).toHaveBeenCalledWith({
      where: { productId: "product_stock_1", status: InventoryStatus.AVAILABLE }
    });
    expect(tx.inventoryItem.findMany).toHaveBeenCalledWith({
      where: { productId: "product_stock_1", status: InventoryStatus.AVAILABLE },
      orderBy: { createdAt: "asc" },
      take: 2
    });
    expect(tx.inventoryItem.updateMany).toHaveBeenCalledWith({
      where: { id: { in: ["inv_1", "inv_2"] }, status: InventoryStatus.AVAILABLE },
      data: expect.objectContaining({
        status: InventoryStatus.SOLD,
        orderId: "order_stock_1"
      })
    });
    expect(tx.order.update).toHaveBeenCalledWith({
      where: { id: "order_stock_1" },
      data: expect.objectContaining({
        status: OrderStatus.FULFILLED,
        deliveryText: "account-1\naccount-2"
      })
    });
    expect(notifyManualOrderIfNeeded).toHaveBeenCalledWith("order_stock_1");
  });
});

function buildPurchaseTx(input: {
  user: { id: string; telegramId: string };
  product: Record<string, unknown>;
  balance: number;
  orderId: string;
  paymentId: string;
  inventoryItems?: Array<{ id: string; content: string }>;
}) {
  const inventoryItems = input.inventoryItems ?? [];
  return {
    telegramUser: {
      findUnique: vi.fn().mockResolvedValue(input.user)
    },
    product: {
      findUnique: vi.fn().mockResolvedValue(input.product),
      updateMany: vi.fn().mockResolvedValue({ count: 1 })
    },
    walletLedgerEntry: {
      aggregate: vi.fn().mockResolvedValue({ _sum: { amount: input.balance } }),
      create: vi.fn().mockImplementation(({ data }) => Promise.resolve({ id: "ledger_1", ...data }))
    },
    payment: {
      findUnique: vi.fn().mockResolvedValue(null),
      create: vi.fn().mockImplementation(({ data }) => Promise.resolve({ id: input.paymentId, ...data }))
    },
    order: {
      findUnique: vi.fn().mockResolvedValue(null),
      create: vi.fn().mockImplementation(({ data }) => Promise.resolve({ id: input.orderId, ...data })),
      update: vi.fn().mockImplementation(({ data }) => Promise.resolve({ id: input.orderId, ...data }))
    },
    inventoryItem: {
      count: vi.fn().mockResolvedValue(inventoryItems.length),
      findMany: vi.fn().mockResolvedValue(inventoryItems),
      updateMany: vi.fn().mockResolvedValue({ count: inventoryItems.length })
    }
  };
}
