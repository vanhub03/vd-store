import crypto from "node:crypto";
import { describe, expect, it } from "vitest";
import { signPartnerWebhook } from "../src/partner/partner-webhook.service";

describe("partner webhook signing", () => {
  it("signs timestamp and raw body with HMAC-SHA256", () => {
    const body = JSON.stringify({ id: "evt_1", type: "order.updated" });
    const timestamp = 1_782_000_000;
    const secret = "whsec_test_secret";
    const expected = crypto.createHmac("sha256", secret).update(`${timestamp}.${body}`).digest("hex");
    expect(signPartnerWebhook(body, timestamp, secret)).toBe(expected);
    expect(signPartnerWebhook(`${body} `, timestamp, secret)).not.toBe(expected);
  });
});
