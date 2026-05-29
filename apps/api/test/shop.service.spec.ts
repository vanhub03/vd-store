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
  it("returns only active web-visible catalog products and maps prices to webPrice", async () => {
    const categoryProduct = {
      id: "product_web_category_1",
      name: "Visible web category product",
      price: 10000,
      botPrice: 8000,
      webPrice: 12000,
      showInWeb: true,
      showInBot: true,
      status: ProductStatus.ACTIVE,
      deliveryType: ProductDeliveryType.MANUAL
    };
    const uncategorizedProduct = {
      id: "product_web_uncategorized_1",
      name: "Visible web uncategorized product",
      price: 15000,
      botPrice: 9000,
      webPrice: 18000,
      showInWeb: true,
      showInBot: false,
      status: ProductStatus.ACTIVE,
      deliveryType: ProductDeliveryType.MANUAL
    };
    const prisma = {
      category: {
        findMany: vi.fn().mockResolvedValue([
          {
            id: "category_1",
            name: "Digital",
            active: true,
            products: [categoryProduct]
          }
        ])
      },
      product: {
        findMany: vi.fn().mockResolvedValue([uncategorizedProduct])
      }
    };
    const service = new ShopService(prisma as never, {} as never, {} as never);

    const catalog = await service.getCatalog("web");

    expect(prisma.category.findMany).toHaveBeenCalledWith({
      where: { active: true },
      orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
      include: {
        products: {
          where: { status: ProductStatus.ACTIVE, showInWeb: true },
          orderBy: { createdAt: "desc" },
          include: {
            _count: {
              select: {
                inventoryItems: { where: { status: InventoryStatus.AVAILABLE } }
              }
            }
          }
        }
      }
    });
    expect(prisma.product.findMany).toHaveBeenCalledWith({
      where: { categoryId: null, status: ProductStatus.ACTIVE, showInWeb: true },
      orderBy: { createdAt: "desc" },
      include: {
        _count: {
          select: {
            inventoryItems: { where: { status: InventoryStatus.AVAILABLE } }
          }
        }
      }
    });
    expect(catalog.categories[0].products[0].price).toBe(12000);
    expect(catalog.uncategorized[0].price).toBe(18000);
  });

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

  it("fulfills direct bank orders when SePay confirms payment before expiry", async () => {
    const user = { id: "user_direct_1", telegramId: "web:customer_direct_1" };
    const product = {
      id: "product_direct_manual_1",
      name: "Direct manual service",
      price: 20000,
      showInWeb: true,
      showInBot: true,
      status: ProductStatus.ACTIVE,
      deliveryType: ProductDeliveryType.MANUAL,
      manualStock: 4,
      manualInstructions: "Gui ma don cho admin de nhan hang."
    };
    const tx = buildDirectOrderTx({
      paymentId: "payment_direct_1",
      orderId: "order_direct_1",
      user,
      product,
      quantity: 2,
      amount: 40000,
      expiresAt: new Date(Date.now() + 60_000)
    });
    const prisma = {
      $transaction: vi.fn(async (callback) => callback(tx))
    };
    const service = new ShopService(prisma as never, {} as never, {} as never);

    const result = await service.fulfillDirectOrder("payment_direct_1");

    expect(result.outcome).toBe("fulfilled");
    expect("deliveryText" in result ? result.deliveryText : "").toBe("Gui ma don cho admin de nhan hang.");
    expect(tx.product.updateMany).toHaveBeenCalledWith({
      where: { id: "product_direct_manual_1", manualStock: { gte: 2 } },
      data: { manualStock: { decrement: 2 } }
    });
    expect(tx.payment.update).toHaveBeenCalledWith({
      where: { id: "payment_direct_1" },
      data: { status: PaymentStatus.SUCCEEDED }
    });
    expect(tx.order.update).toHaveBeenCalledWith({
      where: { id: "order_direct_1" },
      data: expect.objectContaining({
        status: OrderStatus.FULFILLED,
        deliveryText: "Gui ma don cho admin de nhan hang."
      })
    });
    expect(tx.walletLedgerEntry.create).not.toHaveBeenCalled();
  });

  it("credits expired direct bank payments to wallet instead of fulfilling the order", async () => {
    const user = { id: "user_direct_2", telegramId: "web:customer_direct_2" };
    const product = {
      id: "product_direct_stock_1",
      name: "Expired stock service",
      price: 30000,
      showInWeb: true,
      showInBot: true,
      status: ProductStatus.ACTIVE,
      deliveryType: ProductDeliveryType.STOCK_ITEM
    };
    const tx = buildDirectOrderTx({
      paymentId: "payment_direct_expired_1",
      orderId: "order_direct_expired_1",
      user,
      product,
      quantity: 1,
      amount: 30000,
      expiresAt: new Date(Date.now() - 60_000)
    });
    const prisma = {
      $transaction: vi.fn(async (callback) => callback(tx))
    };
    const service = new ShopService(prisma as never, {} as never, {} as never);

    const result = await service.fulfillDirectOrder("payment_direct_expired_1");

    expect(result.outcome).toBe("credited_late_payment");
    expect(tx.walletLedgerEntry.findFirst).toHaveBeenCalledWith({
      where: { referencePaymentId: "payment_direct_expired_1" }
    });
    expect(tx.walletLedgerEntry.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        userId: "user_direct_2",
        amount: 30000,
        type: WalletEntryType.DIRECT_PAYMENT_CREDIT,
        referencePaymentId: "payment_direct_expired_1"
      })
    });
    expect(tx.payment.update).toHaveBeenCalledWith({
      where: { id: "payment_direct_expired_1" },
      data: { status: PaymentStatus.CREDITED_TO_WALLET }
    });
    expect(tx.order.update).toHaveBeenCalledWith({
      where: { id: "order_direct_expired_1" },
      data: { status: OrderStatus.CREDITED_TO_WALLET }
    });
    expect(tx.inventoryItem.findMany).not.toHaveBeenCalled();
  });

  it("credits topups exactly once and ignores already-processed topup payments", async () => {
    const pendingTx = buildTopupTx({
      status: PaymentStatus.PENDING,
      paymentId: "payment_topup_1",
      userId: "user_topup_1",
      amount: 25000
    });
    const processedTx = buildTopupTx({
      status: PaymentStatus.SUCCEEDED,
      paymentId: "payment_topup_1",
      userId: "user_topup_1",
      amount: 25000
    });
    const prisma = {
      $transaction: vi.fn()
        .mockImplementationOnce(async (callback) => callback(pendingTx))
        .mockImplementationOnce(async (callback) => callback(processedTx))
    };
    const service = new ShopService(prisma as never, {} as never, {} as never);

    const first = await service.creditTopup("payment_topup_1");
    const second = await service.creditTopup("payment_topup_1");

    expect(first.outcome).toBe("credited");
    expect(pendingTx.walletLedgerEntry.findFirst).toHaveBeenCalledWith({
      where: { referencePaymentId: "payment_topup_1" }
    });
    expect(pendingTx.walletLedgerEntry.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        userId: "user_topup_1",
        amount: 25000,
        type: WalletEntryType.TOPUP,
        referencePaymentId: "payment_topup_1"
      })
    });
    expect(pendingTx.payment.update).toHaveBeenCalledWith({
      where: { id: "payment_topup_1" },
      data: { status: PaymentStatus.SUCCEEDED }
    });

    expect(second.outcome).toBe("already_processed");
    expect(processedTx.walletLedgerEntry.findFirst).not.toHaveBeenCalled();
    expect(processedTx.walletLedgerEntry.create).not.toHaveBeenCalled();
    expect(processedTx.payment.update).not.toHaveBeenCalled();
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

function buildDirectOrderTx(input: {
  paymentId: string;
  orderId: string;
  user: { id: string; telegramId: string };
  product: Record<string, unknown>;
  quantity: number;
  amount: number;
  expiresAt: Date;
}) {
  const order = {
    id: input.orderId,
    code: "DHWEB123",
    userId: input.user.id,
    productId: input.product.id,
    quantity: input.quantity,
    totalAmount: input.amount,
    expiresAt: input.expiresAt,
    product: input.product,
    user: input.user
  };
  const payment = {
    id: input.paymentId,
    code: "DHWEB123",
    kind: PaymentKind.DIRECT_ORDER,
    status: PaymentStatus.PENDING,
    amount: input.amount,
    userId: input.user.id,
    expiresAt: input.expiresAt,
    order,
    user: input.user
  };
  return {
    payment: {
      findUnique: vi.fn().mockResolvedValue(payment),
      update: vi.fn().mockImplementation(({ data }) => Promise.resolve({ ...payment, ...data }))
    },
    product: {
      updateMany: vi.fn().mockResolvedValue({ count: 1 })
    },
    order: {
      update: vi.fn().mockImplementation(({ data }) => Promise.resolve({ ...order, ...data }))
    },
    inventoryItem: {
      count: vi.fn().mockResolvedValue(2),
      findMany: vi.fn().mockResolvedValue([{ id: "inv_direct_1", content: "direct-account" }]),
      updateMany: vi.fn().mockResolvedValue({ count: 1 })
    },
    walletLedgerEntry: {
      findFirst: vi.fn().mockResolvedValue(null),
      create: vi.fn().mockImplementation(({ data }) => Promise.resolve({ id: "ledger_direct_1", ...data }))
    }
  };
}

function buildTopupTx(input: {
  status: PaymentStatus;
  paymentId: string;
  userId: string;
  amount: number;
}) {
  const user = { id: input.userId, telegramId: "web:topup_customer" };
  const payment = {
    id: input.paymentId,
    code: "NAPTOPUP1",
    kind: PaymentKind.TOPUP,
    status: input.status,
    amount: input.amount,
    userId: input.userId,
    user
  };
  return {
    payment: {
      findUnique: vi.fn().mockResolvedValue(payment),
      update: vi.fn().mockImplementation(({ data }) => Promise.resolve({ ...payment, ...data }))
    },
    walletLedgerEntry: {
      findFirst: vi.fn().mockResolvedValue(null),
      create: vi.fn().mockImplementation(({ data }) => Promise.resolve({ id: "ledger_topup_1", ...data }))
    }
  };
}
