import { CustomerRole, PartnerEnvironment, PartnerOrderItemStatus, PartnerOrderStatus, ProductDeliveryType } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";
import { hashApiKey } from "../src/partner/partner-auth.guard";
import { PartnerService } from "../src/partner/partner.service";

describe("PartnerService", () => {
  it("creates one-time API secrets and stores only their hash", async () => {
    let stored: Record<string, unknown> | undefined;
    const prisma = {
      telegramUser: { findUnique: vi.fn().mockResolvedValue({ id: "ctv_1", role: CustomerRole.COLLABORATOR }) },
      partnerApiCredential: {
        create: vi.fn(async ({ data }) => {
          stored = data;
          return { id: "key_1", ...data, revokedAt: null, lastUsedAt: null, createdAt: new Date() };
        })
      },
      auditLog: { create: vi.fn().mockResolvedValue({}) }
    };
    const service = new PartnerService(prisma as never, {} as never, {} as never);

    const result = await service.createCredential("admin_1", "ctv_1", { environment: PartnerEnvironment.TEST });

    expect(result.secret).toMatch(/^vd_test_[A-Za-z0-9_-]{32,}$/);
    expect(stored?.keyHash).toBe(hashApiKey(result.secret));
    expect(stored?.keyHash).not.toBe(result.secret);
    expect(stored?.keyPrefix).toBe(result.secret.slice(0, 20));
  });

  it("creates sandbox orders without calling the live wallet purchase path and replays an idempotent request", async () => {
    let idempotency: Record<string, unknown> | null = null;
    const createdAt = new Date("2026-06-20T00:00:00.000Z");
    const partnerOrder = {
      id: "po_test_1",
      userId: "ctv_1",
      environment: PartnerEnvironment.TEST,
      externalOrderId: "partner-order-1",
      status: PartnerOrderStatus.FULFILLED,
      currency: "VND",
      subtotalAmount: 100_000,
      collaboratorDiscountAmount: 10_000,
      voucherDiscountAmount: 0,
      totalAmount: 90_000,
      refundedAmount: 0,
      voucherCode: null,
      createdAt,
      updatedAt: createdAt,
      items: [{
        id: "poi_test_1",
        productId: "product_1",
        productName: "Test product",
        deliveryType: ProductDeliveryType.STOCK_ITEM,
        quantity: 1,
        unitPrice: 100_000,
        subtotalAmount: 100_000,
        collaboratorDiscountAmount: 10_000,
        voucherDiscountAmount: 0,
        totalAmount: 90_000,
        status: PartnerOrderItemStatus.FULFILLED,
        deliveryText: "TEST_DELIVERY"
      }]
    };
    const prisma = {
      apiIdempotencyRecord: {
        findUnique: vi.fn(async () => idempotency),
        create: vi.fn(async ({ data }) => { idempotency = { ...data, status: "PENDING", responseStatus: null, responseBody: null }; return idempotency; }),
        update: vi.fn(async ({ data }) => { idempotency = { ...idempotency, ...data }; return idempotency; }),
        updateMany: vi.fn(),
        deleteMany: vi.fn(),
        delete: vi.fn()
      },
      partnerOrder: {
        findUnique: vi.fn().mockResolvedValue(null),
        create: vi.fn().mockResolvedValue(partnerOrder)
      }
    };
    const shop = {
      previewPartnerCart: vi.fn().mockResolvedValue({
        quote: { code: null, subtotalAmount: 100_000, collaboratorDiscountAmount: 10_000, voucherDiscountAmount: 0, totalAmount: 90_000 },
        lines: [{
          product: { id: "product_1", name: "Test product", deliveryType: ProductDeliveryType.STOCK_ITEM },
          quantity: 1,
          unitPrice: 100_000,
          subtotalAmount: 100_000,
          collaboratorDiscountAmount: 10_000,
          voucherDiscountAmount: 0,
          totalAmount: 90_000
        }]
      }),
      purchasePartnerCart: vi.fn()
    };
    const webhooks = { emit: vi.fn().mockResolvedValue("evt_1") };
    const service = new PartnerService(prisma as never, shop as never, webhooks as never);
    const input = {
      userId: "ctv_1",
      environment: PartnerEnvironment.TEST,
      idempotencyKey: "idem-partner-order-1",
      externalOrderId: "partner-order-1",
      items: [{ productId: "product_1", quantity: 1 }]
    };

    const first = await service.createOrder(input);
    const replay = await service.createOrder(input);

    expect(first).toEqual(replay);
    expect(shop.purchasePartnerCart).not.toHaveBeenCalled();
    expect(shop.previewPartnerCart).toHaveBeenCalledTimes(1);
    expect(prisma.partnerOrder.create).toHaveBeenCalledTimes(1);
    expect(webhooks.emit).toHaveBeenCalledTimes(1);
  });

  it("fulfills sandbox manual items with simulated content without touching live order, wallet, or stock state", async () => {
    const createdAt = new Date("2026-06-20T00:00:00.000Z");
    const sandboxItem = {
      id: "poi_test_manual_1",
      partnerOrderId: "po_test_manual_1",
      productId: "product_manual_1",
      sourceOrderId: null,
      productName: "Manual product",
      deliveryType: ProductDeliveryType.MANUAL,
      quantity: 1,
      unitPrice: 100_000,
      subtotalAmount: 100_000,
      collaboratorDiscountAmount: 10_000,
      voucherDiscountAmount: 0,
      totalAmount: 90_000,
      status: PartnerOrderItemStatus.PENDING_FULFILLMENT,
      deliveryText: null,
      refundedAt: null,
      createdAt,
      updatedAt: createdAt,
      partnerOrder: {
        id: "po_test_manual_1",
        userId: "ctv_1",
        environment: PartnerEnvironment.TEST,
        externalOrderId: "sandbox-manual-1",
        status: PartnerOrderStatus.PENDING_FULFILLMENT,
        currency: "VND",
        subtotalAmount: 100_000,
        collaboratorDiscountAmount: 10_000,
        voucherDiscountAmount: 0,
        totalAmount: 90_000,
        refundedAmount: 0,
        voucherCode: null,
        createdAt,
        updatedAt: createdAt
      },
      product: {},
      sourceOrder: null
    };
    let updatedItem = sandboxItem;
    const tx = {
      partnerOrderItem: {
        findUnique: vi.fn().mockResolvedValue(sandboxItem),
        update: vi.fn(async ({ data }) => {
          updatedItem = { ...sandboxItem, ...data };
          return updatedItem;
        }),
        findMany: vi.fn(async () => [updatedItem])
      },
      order: { update: vi.fn() },
      product: { update: vi.fn(), updateMany: vi.fn() },
      walletLedgerEntry: { create: vi.fn() },
      voucherRedemption: { findUnique: vi.fn(), delete: vi.fn() },
      voucher: { updateMany: vi.fn() },
      voucherAssignment: { updateMany: vi.fn() },
      partnerOrder: {
        update: vi.fn(async ({ data }) => ({
          ...sandboxItem.partnerOrder,
          ...data,
          updatedAt: createdAt,
          items: [updatedItem]
        }))
      },
      auditLog: { create: vi.fn() }
    };
    const prisma = { $transaction: vi.fn((callback) => callback(tx)) };
    const shop = { clearCatalogCache: vi.fn() };
    const webhooks = { emit: vi.fn().mockResolvedValue("evt_1") };
    const service = new PartnerService(prisma as never, shop as never, webhooks as never);

    const result = await service.fulfillItem("admin_1", sandboxItem.id, "COMPLETED", "REAL_SECRET_SHOULD_NOT_LEAK");

    expect(tx.order.update).not.toHaveBeenCalled();
    expect(tx.product.update).not.toHaveBeenCalled();
    expect(tx.product.updateMany).not.toHaveBeenCalled();
    expect(tx.walletLedgerEntry.create).not.toHaveBeenCalled();
    expect(updatedItem.deliveryText).toMatch(/^TEST_MANUAL_DELIVERY_[a-f0-9]+$/);
    expect(updatedItem.deliveryText).not.toBe("REAL_SECRET_SHOULD_NOT_LEAK");
    expect(result.items[0].delivery?.content).toBe(updatedItem.deliveryText);
    expect(shop.clearCatalogCache).toHaveBeenCalledTimes(1);
    expect(webhooks.emit).toHaveBeenCalledWith("ctv_1", PartnerEnvironment.TEST, "order.updated", { order: result }, "po_test_manual_1");
  });
});
