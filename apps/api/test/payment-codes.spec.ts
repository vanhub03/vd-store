import { describe, expect, it } from "vitest";
import { DIRECT_ORDER_PREFIX, extractPaymentCode, generatePaymentCode, isDirectOrderCode, isTopupCode, TOPUP_PREFIX } from "../src/domain/payment-codes";

describe("payment codes", () => {
  it("generates top-up and direct-order codes with stable prefixes", () => {
    const topup = generatePaymentCode(TOPUP_PREFIX);
    const order = generatePaymentCode(DIRECT_ORDER_PREFIX);

    expect(topup).toMatch(/^NAP[A-Z0-9]{6,8}$/);
    expect(order).toMatch(/^DH[A-Z0-9]{6,8}$/);
    expect(isTopupCode(topup)).toBe(true);
    expect(isDirectOrderCode(order)).toBe(true);
  });

  it("extracts payment code from bank transfer content", () => {
    expect(extractPaymentCode("CK mua hang DHABC1234 cam on")).toBe("DHABC1234");
    expect(extractPaymentCode("nap vi napzz9911")).toBe("NAPZZ9911");
    expect(extractPaymentCode("khong co ma")).toBeNull();
  });
});
