import { describe, expect, it, vi } from "vitest";
import { signSepayBody, verifyApiKeyHeader, verifySepayHmac } from "../src/domain/sepay-signature";

describe("sepay webhook security", () => {
  it("verifies API key auth header", () => {
    expect(verifyApiKeyHeader("Apikey secret-key", "secret-key")).toBe(true);
    expect(verifyApiKeyHeader("Bearer secret-key", "secret-key")).toBe(false);
  });

  it("verifies HMAC signature with timestamp skew protection", () => {
    vi.setSystemTime(new Date("2026-05-27T00:00:00Z"));
    const timestamp = String(Math.floor(Date.now() / 1000));
    const rawBody = JSON.stringify({ id: 1, transferAmount: 100000 });
    const signature = signSepayBody(timestamp, rawBody, "webhook-secret");

    expect(verifySepayHmac({ timestamp, rawBody, signature, secret: "webhook-secret" })).toBe(true);
    expect(verifySepayHmac({ timestamp, rawBody, signature, secret: "wrong" })).toBe(false);
    expect(verifySepayHmac({ timestamp: "1", rawBody, signature, secret: "webhook-secret" })).toBe(false);
    vi.useRealTimers();
  });
});
