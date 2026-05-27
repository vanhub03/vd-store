import crypto from "node:crypto";

export const TOPUP_PREFIX = "NAP";
export const DIRECT_ORDER_PREFIX = "DH";

export function generatePaymentCode(prefix: string) {
  let random = "";
  while (random.length < 8) {
    random += crypto.randomBytes(6).toString("base64url").replace(/[^a-zA-Z0-9]/g, "");
  }
  return `${prefix}${random.slice(0, 8)}`.toUpperCase();
}

export function extractPaymentCode(input?: string | null) {
  if (!input) return null;
  const match = input.toUpperCase().match(/\b(NAP|DH)[A-Z0-9]{6,12}\b/);
  return match?.[0] ?? null;
}

export function isTopupCode(code: string) {
  return code.toUpperCase().startsWith(TOPUP_PREFIX);
}

export function isDirectOrderCode(code: string) {
  return code.toUpperCase().startsWith(DIRECT_ORDER_PREFIX);
}
