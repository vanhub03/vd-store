export function formatVnd(amount: number) {
  return new Intl.NumberFormat("vi-VN", {
    style: "currency",
    currency: "VND",
    maximumFractionDigits: 0
  }).format(amount);
}

export function productAvailableQuantity(product: { deliveryType: string; manualStock?: number | null; _count?: { inventoryItems: number } }) {
  if (product.deliveryType === "STOCK_ITEM") return product._count?.inventoryItems ?? 0;
  if (product.deliveryType === "MANUAL") return product.manualStock ?? 0;
  return null;
}

export function productStockLabel(product: { deliveryType: string; manualStock?: number | null; _count?: { inventoryItems: number } }) {
  const quantity = productAvailableQuantity(product);
  if (quantity !== null) return `Số lượng: ${quantity}`;
  return "Số lượng: không giới hạn";
}

export function escapeHtml(input: string) {
  return input.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
