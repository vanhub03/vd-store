import crypto from "node:crypto";
import { UnauthorizedException } from "@nestjs/common";
import { describe, expect, it } from "vitest";
import { PaymentService } from "../src/domain/payment.service";

describe("cryptomus webhook security", () => {
  it("verifies Cryptomus webhook body signatures", () => {
    const service = new PaymentService({} as never, {} as never, {} as never);
    const previousKey = process.env.CRYPTOMUS_PAYMENT_API_KEY;
    process.env.CRYPTOMUS_PAYMENT_API_KEY = "payment-api-key";

    const payload = {
      type: "payment",
      uuid: "crypto_payment_1",
      order_id: "USDT123",
      amount: "10.00000000",
      payment_amount: "10.00000000",
      status: "paid"
    };
    const sign = crypto.createHash("md5").update(Buffer.from(JSON.stringify(payload)).toString("base64") + "payment-api-key").digest("hex");

    expect(() => service.verifyCryptomusRequest({} as never, { ...payload, sign })).not.toThrow();
    expect(() => service.verifyCryptomusRequest({} as never, { ...payload, sign: "bad" })).toThrow(UnauthorizedException);

    if (previousKey === undefined) delete process.env.CRYPTOMUS_PAYMENT_API_KEY;
    else process.env.CRYPTOMUS_PAYMENT_API_KEY = previousKey;
  });
});
