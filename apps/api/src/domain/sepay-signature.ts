import crypto from "node:crypto";

export type SepayAuthMode = "none" | "api-key" | "hmac" | "auto";

export function verifyApiKeyHeader(headerValue: string | undefined, expectedApiKey: string | undefined) {
  const apiKey = expectedApiKey?.trim();
  if (!apiKey) return false;
  const match = headerValue?.match(/^Apikey\s+(.+)$/i);
  if (!match) return false;
  return timingSafeEqual(match[1].trim(), apiKey);
}

export function signSepayBody(timestamp: string, rawBody: Buffer | string, secret: string) {
  return `sha256=${crypto
    .createHmac("sha256", secret)
    .update(`${timestamp}.${Buffer.isBuffer(rawBody) ? rawBody.toString("utf8") : rawBody}`)
    .digest("hex")}`;
}

export function verifySepayHmac(options: {
  rawBody: Buffer | string;
  signature?: string;
  timestamp?: string;
  secret?: string;
  maxSkewSeconds?: number;
}) {
  const { rawBody, signature, timestamp, secret, maxSkewSeconds = 300 } = options;
  const hmacSecret = secret?.trim();
  if (!hmacSecret || !signature || !timestamp) return false;

  const timestampSeconds = Number(timestamp);
  if (!Number.isFinite(timestampSeconds)) return false;
  const nowSeconds = Math.floor(Date.now() / 1000);
  if (Math.abs(nowSeconds - timestampSeconds) > maxSkewSeconds) return false;

  return timingSafeEqual(signSepayBody(timestamp, rawBody, hmacSecret), signature.trim());
}

function timingSafeEqual(a: string, b: string) {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  if (left.length !== right.length) return false;
  return crypto.timingSafeEqual(left, right);
}
