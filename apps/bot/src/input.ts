export const MIN_TOPUP_VND = 1_000;

export function parseQuantityInput(input: string) {
  const normalized = input.trim().replace(/\s/g, "");
  if (!/^\d+$/.test(normalized)) return null;
  const quantity = Number(normalized);
  return Number.isSafeInteger(quantity) && quantity > 0 ? quantity : null;
}

export function parseVndAmount(input?: string) {
  if (!input) return null;
  const normalized = input.trim().toLocaleLowerCase("vi-VN").replace(/\s/g, "");
  const multiplier = normalized.endsWith("k") ? 1_000 : 1;
  const numericPart = normalized.endsWith("k") ? normalized.slice(0, -1) : normalized;
  const digits = numericPart.replace(/[.,_]/g, "");
  if (!/^\d+$/.test(digits)) return null;
  const amount = Number(digits) * multiplier;
  return Number.isSafeInteger(amount) && amount >= MIN_TOPUP_VND ? amount : null;
}

export function isBareNumber(input: string) {
  return /^[\d\s.,_]+k?$/i.test(input.trim());
}
