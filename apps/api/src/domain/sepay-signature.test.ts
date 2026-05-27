import { afterEach, describe, expect, it, vi } from "vitest";
import { signSepayBody, verifySepayHmac } from "./sepay-signature";

describe("SePay HMAC signature", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("verifies the real SePay delivery payload with the configured secret", () => {
    vi.setSystemTime(new Date("2026-05-27T16:05:58.000Z"));

    const secret = "ca3fc4a175aded1f2dfd8cb68e178be8c16ef0bd0b9f0b0307fbb14dec79d5ff";
    const timestamp = "1779897957";
    const rawBody =
      '{"gateway":"TPBank","transactionDate":"2026-05-27 23:05:56","accountNumber":"03219071601","subAccount":null,"code":null,"content":"130948782159 0377952999 NAPMTP9UCUR","transferType":"in","description":"BankAPINotify 130948782159 0377952999 NAPMTP9UCUR","transferAmount":2000,"referenceCode":"401ITC1261480038","accumulated":3022182,"id":60740655}';
    const signature = "sha256=090ce709745dd4af49085a09084778205775d85661af29b6846e55bd6c1660d9";

    expect(signSepayBody(timestamp, rawBody, secret)).toBe(signature);
    expect(
      verifySepayHmac({
        rawBody,
        signature,
        timestamp,
        secret: ` ${secret}\n`
      })
    ).toBe(true);

  });
});
