import { OrderStatus, PaymentKind, PaymentStatus, ProductDeliveryType } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";
import { StoreService } from "../src/store/store.service";

describe("StoreService", () => {
  it("expires stale pending payments when checking storefront payment status", async () => {
    const expiredAt = new Date(Date.now() - 60_000);
    const payment = {
      id: "payment_expired_1",
      code: "DHOLD123",
      kind: PaymentKind.DIRECT_ORDER,
      status: PaymentStatus.PENDING,
      amount: 12000,
      expiresAt: expiredAt,
      order: {
        id: "order_expired_1",
        code: "DHOLD123",
        status: OrderStatus.PENDING_PAYMENT,
        quantity: 1,
        totalAmount: 12000,
        deliveryText: null,
        expiresAt: expiredAt,
        product: {
          id: "product_1",
          name: "Demo product",
          deliveryType: ProductDeliveryType.MANUAL
        }
      }
    };
    const prisma = {
      payment: {
        findFirst: vi.fn().mockResolvedValue(payment),
        update: vi.fn().mockResolvedValue({ ...payment, status: PaymentStatus.EXPIRED })
      },
      order: {
        update: vi.fn().mockResolvedValue({ ...payment.order, status: OrderStatus.EXPIRED })
      }
    };
    const shop = {
      getWalletBalance: vi.fn().mockResolvedValue(5000)
    };

    const service = new StoreService(prisma as never, shop as never);
    const result = await service.paymentStatus("user_1", " DHOLD123 ");

    expect(result.status).toBe(PaymentStatus.EXPIRED);
    expect(result.order?.status).toBe(OrderStatus.EXPIRED);
    expect(prisma.payment.update).toHaveBeenCalledWith({
      where: { id: "payment_expired_1" },
      data: { status: PaymentStatus.EXPIRED }
    });
    expect(prisma.order.update).toHaveBeenCalledWith({
      where: { id: "order_expired_1" },
      data: { status: OrderStatus.EXPIRED }
    });
  });
});
