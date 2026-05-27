export function formatVnd(amount: number) {
  return new Intl.NumberFormat("vi-VN", {
    style: "currency",
    currency: "VND",
    maximumFractionDigits: 0
  }).format(amount);
}

export function productStockLabel(product: { deliveryType: string; _count?: { inventoryItems: number } }) {
  if (product.deliveryType === "STOCK_ITEM") return `Tồn kho: ${product._count?.inventoryItems ?? 0}`;
  if (product.deliveryType === "MANUAL") return "Nhận hàng qua admin";
  return "Giao nội dung số tự động";
}

export function escapeHtml(input: string) {
  return input.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
