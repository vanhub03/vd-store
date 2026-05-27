import crypto from "node:crypto";

export type SepayAuthMode = "none" | "api-key" | "hmac";

export function verifyApiKeyHeader(headerValue: string | undefined, expectedApiKey: string | undefined) {
  if (!expectedApiKey) return false;
  const prefix = "Apikey ";
  if (!headerValue?.startsWith(prefix)) return false;
  return timingSafeEqual(headerValue.slice(prefix.length), expectedApiKey);
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
  if (!secret || !signature || !timestamp) return false;

  const timestampSeconds = Number(timestamp);
  if (!Number.isFinite(timestampSeconds)) return false;
  const nowSeconds = Math.floor(Date.now() / 1000);
  if (Math.abs(nowSeconds - timestampSeconds) > maxSkewSeconds) return false;

  return timingSafeEqual(signSepayBody(timestamp, rawBody, secret), signature);
}

function timingSafeEqual(a: string, b: string) {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  if (left.length !== right.length) return false;
  return crypto.timingSafeEqual(left, right);
}
