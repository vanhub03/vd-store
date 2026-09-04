import {
  CustomerRole,
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
  it("defaults new Cryptomus USDT invoices to BSC when no network override is configured", async () => {
    const previous = {
      merchantId: process.env.CRYPTOMUS_MERCHANT_ID,
      apiKey: process.env.CRYPTOMUS_PAYMENT_API_KEY,
      apiBaseUrl: process.env.CRYPTOMUS_API_BASE_URL,
      network: process.env.CRYPTOMUS_NETWORK
    };
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        state: 0,
        result: { uuid: "cryptomus_1", url: "https://pay.example/cryptomus_1", address: "0xabc", network: "bsc" }
      })
    });
    process.env.CRYPTOMUS_MERCHANT_ID = "merchant_1";
    process.env.CRYPTOMUS_PAYMENT_API_KEY = "api_key_1";
    process.env.CRYPTOMUS_API_BASE_URL = "https://cryptomus.example";
    delete process.env.CRYPTOMUS_NETWORK;
    vi.stubGlobal("fetch", fetchMock);

    try {
      const service = new ShopService({} as never, {} as never, {} as never);
      const result = await (service as unknown as {
        createCryptomusInvoice: (input: { code: string; productName: string; amount: string; expiresAt: Date }) => Promise<{ network: string }>;
      }).createCryptomusInvoice({
        code: "DHUSDTBSC1",
        productName: "USDT BSC test",
        amount: "5.00",
        expiresAt: new Date(Date.now() + 15 * 60_000)
      });

      expect(JSON.parse(fetchMock.mock.calls[0][1].body as string)).toMatchObject({ currency: "USDT", network: "bsc" });
      expect(result.network).toBe("bsc");
    } finally {
      vi.unstubAllGlobals();
      process.env.CRYPTOMUS_MERCHANT_ID = previous.merchantId;
      process.env.CRYPTOMUS_PAYMENT_API_KEY = previous.apiKey;
      process.env.CRYPTOMUS_API_BASE_URL = previous.apiBaseUrl;
      if (previous.network === undefined) delete process.env.CRYPTOMUS_NETWORK;
      else process.env.CRYPTOMUS_NETWORK = previous.network;
    }
  });

  it("searches every admin user in the database and accepts a Telegram @username", async () => {
    const user = {
      id: "user_vanhdao99",
      telegramId: "1387412987",
      username: "vanhdao99",
      firstName: "Vanh",
      lastName: "Đào",
      email: null,
      passwordHash: "hidden"
    };
    const prisma = {
      telegramUser: { findMany: vi.fn().mockResolvedValue([user]) },
      walletLedgerEntry: { groupBy: vi.fn().mockResolvedValue([{ userId: user.id, _sum: { amount: 50000 } }]) }
    };
    const service = new ShopService(prisma as never, {} as never, {} as never);

    const result = await service.listAdminUsers({ take: "500", search: "@vanhdao99" });

    expect(prisma.telegramUser.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: {
        OR: expect.arrayContaining([
          { username: { contains: "vanhdao99", mode: "insensitive" } }
        ])
      },
      take: 500,
      skip: 0
    }));
    expect(result).toEqual([expect.objectContaining({ id: user.id, balance: 50000, passwordHash: undefined })]);
  });

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
          select: expect.objectContaining({
            _count: {
              select: {
                inventoryItems: { where: { status: InventoryStatus.AVAILABLE } }
              }
            }
          })
        }
      }
    });
    expect(prisma.product.findMany).toHaveBeenCalledWith({
      where: { categoryId: null, status: ProductStatus.ACTIVE, showInWeb: true },
      orderBy: { createdAt: "desc" },
      select: expect.objectContaining({
        _count: {
          select: {
            inventoryItems: { where: { status: InventoryStatus.AVAILABLE } }
          }
        }
      })
    });
    const categoryProductSelect = prisma.category.findMany.mock.calls[0][0].include.products.select;
    const uncategorizedSelect = prisma.product.findMany.mock.calls[0][0].select;
    expect(categoryProductSelect).not.toHaveProperty("sharedContent");
    expect(categoryProductSelect).not.toHaveProperty("sharedFilePath");
    expect(categoryProductSelect).not.toHaveProperty("manualInstructions");
    expect(uncategorizedSelect).not.toHaveProperty("sharedContent");
    expect(uncategorizedSelect).not.toHaveProperty("sharedFilePath");
    expect(uncategorizedSelect).not.toHaveProperty("manualInstructions");
    expect(catalog.categories[0].products[0].price).toBe(12000);
    expect(catalog.uncategorized[0].price).toBe(18000);
  });

  it("updates Vietnamese and English product names", async () => {
    const previousProduct = {
      id: "product_name_1",
      name: "Old Vietnamese name",
      nameEn: "Old English name",
      price: 10000,
      showInBot: true,
      showInWeb: true,
      status: ProductStatus.ACTIVE,
      deliveryType: ProductDeliveryType.MANUAL,
      manualStock: 3
    };
    const updatedProduct = {
      ...previousProduct,
      name: "Ten tieng Viet moi",
      nameEn: "New English name"
    };
    const prisma = {
      product: {
        findUnique: vi.fn().mockResolvedValue(previousProduct),
        update: vi.fn().mockResolvedValue(updatedProduct)
      },
      auditLog: {
        create: vi.fn().mockResolvedValue({})
      }
    };
    const service = new ShopService(prisma as never, {} as never, {} as never);

    const result = await service.updateProduct(
      "product_name_1",
      {
        name: "Ten tieng Viet moi",
        nameEn: "New English name",
        deliveryType: ProductDeliveryType.MANUAL
      },
      "admin_1"
    );

    expect(result.name).toBe("Ten tieng Viet moi");
    expect(result.nameEn).toBe("New English name");
    expect(prisma.product.update).toHaveBeenCalledWith({
      where: { id: "product_name_1" },
      data: expect.objectContaining({
        name: "Ten tieng Viet moi",
        nameEn: "New English name"
      })
    });
  });

  it("awards a one-use 10k voucher to a collaborator after a completed order", async () => {
    const createdAt = new Date("2026-06-20T00:00:00.000Z");
    const tx = {
      auditLog: {
        findFirst: vi.fn().mockResolvedValue(null),
        create: vi.fn().mockResolvedValue({})
      },
      telegramUser: {
        findUnique: vi.fn().mockResolvedValue({ id: "ctv_1", role: CustomerRole.COLLABORATOR, isBlocked: false })
      },
      voucher: {
        findUnique: vi.fn().mockResolvedValue(null),
        create: vi.fn(async ({ data }) => ({ id: "voucher_reward_1", usedCount: 0, createdAt, updatedAt: createdAt, ...data }))
      },
      voucherAssignment: {
        create: vi.fn().mockResolvedValue({ id: "assignment_1" })
      }
    };
    const prisma = {
      $transaction: vi.fn((callback) => callback(tx))
    };
    const service = new ShopService(prisma as never, {} as never, {} as never);

    const voucher = await service.awardCollaboratorCompletionVoucher("admin_1", "ctv_1", {
      entityType: "Order",
      entityId: "order_1",
      code: "DH123"
    });

    expect(voucher?.code).toMatch(/^CTV10K-[A-F0-9]{8}$/);
    expect(voucher?.amount).toBe(10_000);
    expect(tx.voucher.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        discountPercent: 100,
        maxDiscountAmount: 10_000,
        active: true,
        firstOrderOnly: false,
        allowCollaboratorStacking: true,
        maxUses: 1,
        createdByAdminId: "admin_1"
      })
    });
    expect(tx.voucherAssignment.create).toHaveBeenCalledWith({
      data: {
        voucherId: "voucher_reward_1",
        userId: "ctv_1",
        assignedByAdminId: "admin_1"
      }
    });
    expect(tx.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        actorAdminId: "admin_1",
        action: "CTV_COMPLETION_VOUCHER_AWARD",
        entityType: "Order",
        entityId: "order_1"
      })
    });
  });

  it("does not award a duplicate completion voucher for the same order", async () => {
    const tx = {
      auditLog: {
        findFirst: vi.fn().mockResolvedValue({ id: "audit_existing" }),
        create: vi.fn()
      },
      telegramUser: { findUnique: vi.fn() },
      voucher: { findUnique: vi.fn(), create: vi.fn() },
      voucherAssignment: { create: vi.fn() }
    };
    const prisma = { $transaction: vi.fn((callback) => callback(tx)) };
    const service = new ShopService(prisma as never, {} as never, {} as never);

    const voucher = await service.awardCollaboratorCompletionVoucher("admin_1", "ctv_1", {
      entityType: "Order",
      entityId: "order_1"
    });

    expect(voucher).toBeNull();
    expect(tx.voucher.create).not.toHaveBeenCalled();
    expect(tx.voucherAssignment.create).not.toHaveBeenCalled();
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

  it("applies the product collaborator discount and stores the pricing snapshot", async () => {
    const user = {
      id: "collaborator_1",
      telegramId: "web:collaborator_1",
      role: CustomerRole.COLLABORATOR,
      isBlocked: false,
      createdAt: new Date()
    };
    const product = {
      id: "product_collaborator_1",
      name: "Collaborator product",
      price: 100000,
      webPrice: 100000,
      botPrice: 100000,
      collaboratorDiscountPercent: 25,
      showInWeb: true,
      showInBot: true,
      status: ProductStatus.ACTIVE,
      deliveryType: ProductDeliveryType.MANUAL,
      manualStock: 5,
      manualInstructions: "Contact admin."
    };
    const tx = buildPurchaseTx({
      user,
      product,
      balance: 300000,
      orderId: "order_collaborator_1",
      paymentId: "payment_collaborator_1"
    });
    const prisma = { $transaction: vi.fn(async (callback) => callback(tx)) };
    const service = new ShopService(prisma as never, {} as never, {} as never);
    vi.spyOn(service, "notifyManualOrderIfNeeded").mockResolvedValue(undefined);

    const result = await service.purchaseWithWallet(user.telegramId, product.id, 2, "web");

    expect(result.balanceAfter).toBe(150000);
    expect(tx.order.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        unitPrice: 100000,
        subtotalAmount: 200000,
        collaboratorDiscountPercent: 25,
        collaboratorDiscountAmount: 50000,
        voucherDiscountAmount: 0,
        discountAmount: 50000,
        totalAmount: 150000,
        customerRoleSnapshot: CustomerRole.COLLABORATOR
      })
    });
    expect(tx.walletLedgerEntry.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ amount: -150000 })
    });
  });

  it("rejects vouchers that are not allowed to stack with collaborator pricing", async () => {
    const prisma = {
      telegramUser: {
        findUnique: vi.fn().mockResolvedValue({
          id: "collaborator_2",
          telegramId: "web:collaborator_2",
          role: CustomerRole.COLLABORATOR,
          isBlocked: false,
          createdAt: new Date()
        })
      },
      product: {
        findUnique: vi.fn().mockResolvedValue({
          id: "product_collaborator_2",
          name: "Collaborator product",
          price: 100000,
          webPrice: 100000,
          botPrice: 100000,
          collaboratorDiscountPercent: 20,
          showInWeb: true,
          showInBot: true,
          status: ProductStatus.ACTIVE,
          deliveryType: ProductDeliveryType.MANUAL,
          manualStock: 5
        })
      },
      voucher: {
        findUnique: vi.fn().mockResolvedValue({
          id: "voucher_1",
          code: "NOCTV",
          discountPercent: 10,
          active: true,
          firstOrderOnly: false,
          allowCollaboratorStacking: false,
          startsAt: new Date(Date.now() - 1000),
          expiresAt: new Date(Date.now() + 60_000),
          maxUses: null,
          usedCount: 0,
          maxDiscountAmount: null,
          maxDiscountUsdt: null
        })
      }
    };
    const service = new ShopService(prisma as never, {} as never, {} as never);

    await expect(service.previewVoucher("web:collaborator_2", "product_collaborator_2", 1, "NOCTV", "web")).rejects.toThrow(
      "không áp dụng cùng giá cộng tác viên"
    );
  });

  it("allows an assigned voucher only for the assigned customer", async () => {
    const voucher = {
      id: "voucher_assigned_1",
      code: "PRIVATE20",
      discountPercent: 20,
      active: true,
      firstOrderOnly: false,
      allowCollaboratorStacking: true,
      startsAt: new Date(Date.now() - 1000),
      expiresAt: new Date(Date.now() + 60_000),
      maxUses: null,
      usedCount: 0,
      maxDiscountAmount: null,
      maxDiscountUsdt: null
    };
    const prisma = {
      telegramUser: {
        findUnique: vi.fn().mockResolvedValue({
          id: "customer_assigned_1",
          telegramId: "web:customer_assigned_1",
          role: CustomerRole.CUSTOMER,
          isBlocked: false,
          createdAt: new Date()
        })
      },
      product: {
        findUnique: vi.fn().mockResolvedValue({
          id: "product_assigned_1",
          name: "Assigned voucher product",
          price: 100000,
          webPrice: 100000,
          botPrice: 100000,
          collaboratorDiscountPercent: 0,
          showInWeb: true,
          showInBot: true,
          status: ProductStatus.ACTIVE,
          deliveryType: ProductDeliveryType.MANUAL,
          manualStock: 5
        })
      },
      voucher: {
        findUnique: vi.fn().mockResolvedValue(voucher)
      },
      voucherAssignment: {
        count: vi.fn().mockResolvedValue(1),
        findUnique: vi.fn().mockResolvedValue({ id: "assignment_1", revokedAt: null, usedAt: null })
      },
      voucherRedemption: {
        findFirst: vi.fn().mockResolvedValue(null)
      }
    };
    const service = new ShopService(prisma as never, {} as never, {} as never);

    const quote = await service.previewVoucher("web:customer_assigned_1", "product_assigned_1", 1, "PRIVATE20", "web");

    expect(quote.discountAmount).toBe(20000);
    expect(quote.totalAmount).toBe(80000);
    expect(prisma.voucherAssignment.findUnique).toHaveBeenCalledWith({
      where: { voucherId_userId: { voucherId: "voucher_assigned_1", userId: "customer_assigned_1" } },
      select: { id: true, revokedAt: true, usedAt: true }
    });
  });

  it("rejects an assigned voucher for a customer without an active assignment", async () => {
    const prisma = {
      telegramUser: {
        findUnique: vi.fn().mockResolvedValue({
          id: "customer_unassigned_1",
          telegramId: "web:customer_unassigned_1",
          role: CustomerRole.CUSTOMER,
          isBlocked: false,
          createdAt: new Date()
        })
      },
      product: {
        findUnique: vi.fn().mockResolvedValue({
          id: "product_assigned_2",
          name: "Assigned voucher product",
          price: 100000,
          webPrice: 100000,
          botPrice: 100000,
          collaboratorDiscountPercent: 0,
          showInWeb: true,
          showInBot: true,
          status: ProductStatus.ACTIVE,
          deliveryType: ProductDeliveryType.MANUAL,
          manualStock: 5
        })
      },
      voucher: {
        findUnique: vi.fn().mockResolvedValue({
          id: "voucher_assigned_2",
          code: "PRIVATE20",
          discountPercent: 20,
          active: true,
          firstOrderOnly: false,
          allowCollaboratorStacking: true,
          startsAt: new Date(Date.now() - 1000),
          expiresAt: new Date(Date.now() + 60_000),
          maxUses: null,
          usedCount: 0,
          maxDiscountAmount: null,
          maxDiscountUsdt: null
        })
      },
      voucherAssignment: {
        count: vi.fn().mockResolvedValue(1),
        findUnique: vi.fn().mockResolvedValue(null)
      }
    };
    const service = new ShopService(prisma as never, {} as never, {} as never);

    await expect(service.previewVoucher("web:customer_unassigned_1", "product_assigned_2", 1, "PRIVATE20", "web")).rejects.toThrow(
      "kh"
    );
  });

  it("prices every collaborator cart line independently for multiple products and quantities", async () => {
    const user = {
      id: "collaborator_cart_1",
      telegramId: "web:collaborator_cart_1",
      role: CustomerRole.COLLABORATOR,
      isBlocked: false,
      createdAt: new Date()
    };
    const products = [
      {
        id: "product_cart_1",
        name: "Product one",
        price: 10000,
        webPrice: 10000,
        botPrice: 10000,
        collaboratorDiscountPercent: 10,
        showInWeb: true,
        showInBot: true,
        status: ProductStatus.ACTIVE,
        deliveryType: ProductDeliveryType.MANUAL,
        manualStock: 10,
        manualInstructions: "Product one delivery."
      },
      {
        id: "product_cart_2",
        name: "Product two",
        price: 20000,
        webPrice: 20000,
        botPrice: 20000,
        collaboratorDiscountPercent: 25,
        showInWeb: true,
        showInBot: true,
        status: ProductStatus.ACTIVE,
        deliveryType: ProductDeliveryType.MANUAL,
        manualStock: 10,
        manualInstructions: "Product two delivery."
      }
    ];
    const tx = buildCartPurchaseTx({ user, products, balance: 100000 });
    const prisma = { $transaction: vi.fn(async (callback) => callback(tx)) };
    const service = new ShopService(prisma as never, {} as never, {} as never);
    vi.spyOn(service, "notifyManualOrderIfNeeded").mockResolvedValue(undefined);

    const result = await service.purchaseCartWithWallet(
      user.telegramId,
      [
        { productId: products[0].id, quantity: 2 },
        { productId: products[1].id, quantity: 3 }
      ],
      "web"
    );

    expect(result.balanceAfter).toBe(37000);
    expect(tx.order.create).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        data: expect.objectContaining({
          productId: "product_cart_1",
          quantity: 2,
          unitPrice: 10000,
          subtotalAmount: 20000,
          collaboratorDiscountPercent: 10,
          collaboratorDiscountAmount: 2000,
          voucherDiscountAmount: 0,
          totalAmount: 18000
        })
      })
    );
    expect(tx.order.create).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        data: expect.objectContaining({
          productId: "product_cart_2",
          quantity: 3,
          unitPrice: 20000,
          subtotalAmount: 60000,
          collaboratorDiscountPercent: 25,
          collaboratorDiscountAmount: 15000,
          voucherDiscountAmount: 0,
          totalAmount: 45000
        })
      })
    );
    expect(tx.payment.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ amount: 63000, expectedAmount: 63000 })
    });
    expect(tx.walletLedgerEntry.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ amount: -63000 })
    });
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

  it("fulfills direct bank orders when the bank transaction happened before expiry but webhook arrives late", async () => {
    const user = { id: "user_direct_late_webhook", telegramId: "web:customer_direct_late_webhook" };
    const product = {
      id: "product_direct_late_webhook",
      name: "Late webhook manual service",
      price: 225000,
      showInWeb: true,
      showInBot: true,
      status: ProductStatus.ACTIVE,
      deliveryType: ProductDeliveryType.MANUAL,
      manualStock: 2,
      manualInstructions: "Nhan hang qua email."
    };
    const expiresAt = new Date("2026-06-10T04:20:00.000Z");
    const tx = buildDirectOrderTx({
      paymentId: "payment_direct_late_webhook",
      orderId: "order_direct_late_webhook",
      user,
      product,
      quantity: 1,
      amount: 225000,
      expiresAt
    });
    const prisma = {
      $transaction: vi.fn(async (callback) => callback(tx))
    };
    const service = new ShopService(prisma as never, {} as never, {} as never);

    const result = await service.fulfillDirectOrder("payment_direct_late_webhook", new Date("2026-06-10T04:13:00.000Z"));

    expect(result.outcome).toBe("fulfilled");
    expect(tx.payment.update).toHaveBeenCalledWith({
      where: { id: "payment_direct_late_webhook" },
      data: { status: PaymentStatus.SUCCEEDED }
    });
    expect(tx.walletLedgerEntry.create).not.toHaveBeenCalled();
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
  user: { id: string; telegramId: string; role?: CustomerRole; isBlocked?: boolean; createdAt?: Date };
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

function buildCartPurchaseTx(input: {
  user: { id: string; telegramId: string; role: CustomerRole; isBlocked: boolean; createdAt: Date };
  products: Array<Record<string, unknown> & { id: string; name: string }>;
  balance: number;
}) {
  let orderIndex = 0;
  const orders = new Map<string, Record<string, unknown>>();
  return {
    telegramUser: {
      findUnique: vi.fn().mockResolvedValue(input.user)
    },
    product: {
      findMany: vi.fn().mockResolvedValue(input.products),
      updateMany: vi.fn().mockResolvedValue({ count: 1 })
    },
    walletLedgerEntry: {
      aggregate: vi.fn().mockResolvedValue({ _sum: { amount: input.balance } }),
      create: vi.fn().mockImplementation(({ data }) => Promise.resolve({ id: "ledger_cart_1", ...data }))
    },
    payment: {
      findUnique: vi.fn().mockResolvedValue(null),
      create: vi.fn().mockImplementation(({ data }) => Promise.resolve({ id: "payment_cart_1", ...data }))
    },
    order: {
      findUnique: vi.fn().mockResolvedValue(null),
      create: vi.fn().mockImplementation(({ data }) => {
        orderIndex += 1;
        const order = { id: `order_cart_${orderIndex}`, ...data };
        orders.set(order.id, order);
        return Promise.resolve(order);
      }),
      update: vi.fn().mockImplementation(({ where, data }) => {
        const order = orders.get(where.id) ?? {};
        const product = input.products.find((item) => item.id === order.productId);
        return Promise.resolve({ ...order, ...data, product });
      })
    },
    inventoryItem: {
      count: vi.fn(),
      findMany: vi.fn(),
      updateMany: vi.fn()
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
