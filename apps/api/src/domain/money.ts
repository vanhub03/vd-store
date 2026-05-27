export function assertPositiveVnd(amount: number) {
  if (!Number.isInteger(amount) || amount <= 0) {
    throw new Error("Số tiền phải là số nguyên VND lớn hơn 0.");
  }
}

export function formatVnd(amount: number) {
  return new Intl.NumberFormat("vi-VN", {
    style: "currency",
    currency: "VND",
    maximumFractionDigits: 0
  }).format(amount);
}
