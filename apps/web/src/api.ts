const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? "http://localhost:3000";

export type Session = {
  token: string;
  customer: Customer;
};

export type Customer = {
  id: string;
  email: string;
  displayName?: string | null;
};

export type Product = {
  id: string;
  name: string;
  description?: string | null;
  imageUrl?: string | null;
  buttonIcon?: string | null;
  price: number;
  deliveryType: "STOCK_ITEM" | "SHARED_CONTENT" | "MANUAL";
  manualStock?: number | null;
  category?: { id: string; name: string } | null;
  _count?: { inventoryItems: number };
};

export type Catalog = {
  categories: Array<{ id: string; name: string; products: Product[] }>;
  uncategorized: Product[];
};

export type PaymentResult = {
  payment: {
    id: string;
    code: string;
    amount: number;
    qrImageUrl: string;
    expiresAt: string;
  };
  code: string;
  amount: number;
  qrImageUrl: string;
  expiresAt: string;
};

export type WalletPurchaseResult = {
  deliveryText: string;
  balanceAfter: number;
  order?: {
    code: string;
    status?: string;
    quantity: number;
    totalAmount: number;
    deliveryText?: string | null;
    product?: { id?: string; name: string; deliveryType?: Product["deliveryType"] };
  };
};

export type PaymentStatusResult = {
  code: string;
  kind: "TOPUP" | "DIRECT_ORDER" | "WALLET_PURCHASE" | "ADMIN_ADJUSTMENT";
  status: "PENDING" | "SUCCEEDED" | "EXPIRED" | "FAILED" | "CREDITED_TO_WALLET" | "MANUAL_REVIEW";
  amount: number;
  expiresAt?: string | null;
  balance: number;
  order?: {
    code: string;
    status: string;
    quantity: number;
    totalAmount: number;
    deliveryText?: string | null;
    product: { id: string; name: string; deliveryType: Product["deliveryType"] };
  } | null;
};

export type History = {
  orders: Array<{
    code: string;
    totalAmount: number;
    status: string;
    createdAt: string;
    quantity: number;
    deliveryText?: string | null;
    product: { name: string; deliveryType?: Product["deliveryType"] };
  }>;
  ledger: Array<{
    amount: number;
    type: string;
    note?: string | null;
    createdAt: string;
  }>;
};

export class StoreApi {
  constructor(private token: string | null) {}

  setToken(token: string | null) {
    this.token = token;
  }

  get<T>(path: string) {
    return this.request<T>("GET", path);
  }

  post<T>(path: string, body?: unknown) {
    return this.request<T>("POST", path, body);
  }

  private async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const response = await fetch(`${API_BASE_URL}${path}`, {
      method,
      headers: {
        "content-type": "application/json",
        ...(this.token ? { authorization: `Bearer ${this.token}` } : {})
      },
      body: body === undefined ? undefined : JSON.stringify(body)
    });
    const text = await response.text();
    const data = text ? JSON.parse(text) : null;
    if (!response.ok) {
      const message = data?.message ?? data?.error ?? `HTTP ${response.status}`;
      throw new Error(Array.isArray(message) ? message.join(", ") : message);
    }
    return data as T;
  }
}

export function flattenCatalog(catalog: Catalog) {
  return [...catalog.categories.flatMap((category) => category.products.map((product) => ({ ...product, category }))), ...catalog.uncategorized];
}

export function availableQuantity(product: Product) {
  if (product.deliveryType === "MANUAL") return product.manualStock ?? 0;
  if (product.deliveryType === "SHARED_CONTENT") return 999;
  return product._count?.inventoryItems ?? 0;
}

export function formatVnd(amount: number) {
  return new Intl.NumberFormat("vi-VN", {
    style: "currency",
    currency: "VND",
    maximumFractionDigits: 0
  }).format(amount);
}
