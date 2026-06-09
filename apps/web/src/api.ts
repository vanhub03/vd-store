const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? "http://localhost:3000";

export type Session = {
  token: string;
  customer: Customer;
};

export type Customer = {
  id: string;
  email: string;
  displayName?: string | null;
  role: "CUSTOMER" | "COLLABORATOR";
  isBlocked: boolean;
};

export type Product = {
  id: string;
  name: string;
  nameEn?: string | null;
  description?: string | null;
  descriptionEn?: string | null;
  imageUrl?: string | null;
  buttonIcon?: string | null;
  price: number;
  regularPrice?: number;
  collaboratorPrice?: number;
  collaboratorDiscountPercent?: number;
  usdtPrice?: string | number | null;
  regularUsdtPrice?: string | number | null;
  collaboratorUsdtPrice?: string | number | null;
  deliveryType: "STOCK_ITEM" | "SHARED_CONTENT" | "MANUAL";
  manualStock?: number | null;
  category?: { id: string; name: string } | null;
  _count?: { inventoryItems: number };
};

export type ProductReview = {
  id: string;
  rating: number;
  title?: string | null;
  content: string;
  createdAt: string;
  author: string;
  product: {
    id: string;
    name: string;
    nameEn?: string | null;
    imageUrl?: string | null;
    buttonIcon?: string | null;
  };
};

export type ReviewsResponse = {
  reviews: ProductReview[];
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
    checkoutUrl?: string | null;
    deeplink?: string | null;
    cryptoCurrency?: string | null;
    cryptoAmount?: string | number | null;
    address?: string | null;
    network?: string | null;
    expiresAt: string;
  };
  code: string;
  amount: number;
  qrImageUrl: string;
  checkoutUrl?: string | null;
  deeplink?: string | null;
  cryptoCurrency?: string | null;
  cryptoAmount?: string | number | null;
  address?: string | null;
  network?: string | null;
  expiresAt: string;
  voucher?: VoucherPreview | null;
};

export type VoucherPreview = {
  code: string | null;
  discountPercent: number;
  subtotalAmount: number;
  collaboratorDiscountAmount: number;
  voucherDiscountAmount: number;
  discountAmount: number;
  totalAmount: number;
  maxDiscountAmount?: number | null;
  maxDiscountUsdt?: number | null;
  firstOrderOnly: boolean;
  expiresAt?: string | null;
};

export type WalletPurchaseResult = {
  deliveryText: string;
  balanceAfter: number;
  voucher?: VoucherPreview | null;
  order?: {
    code: string;
    status?: string;
    quantity: number;
    subtotalAmount?: number;
    discountAmount?: number;
    totalAmount: number;
    deliveryText?: string | null;
    product?: { id?: string; name: string; deliveryType?: Product["deliveryType"] };
  };
};

export type CartPurchaseResult = WalletPurchaseResult & {
  orders: Array<{
    code: string;
    status?: string;
    quantity: number;
    subtotalAmount?: number;
    discountAmount?: number;
    totalAmount: number;
    deliveryText?: string | null;
    product: { id?: string; name: string; deliveryType?: Product["deliveryType"] };
  }>;
};

export type PaymentStatusResult = {
  code: string;
  kind: "TOPUP" | "DIRECT_ORDER" | "WALLET_PURCHASE" | "ADMIN_ADJUSTMENT";
  status: "PENDING" | "SUCCEEDED" | "EXPIRED" | "FAILED" | "CREDITED_TO_WALLET" | "MANUAL_REVIEW";
  amount: number;
  cryptoCurrency?: string | null;
  cryptoAmount?: string | number | null;
  address?: string | null;
  network?: string | null;
  qrImageUrl?: string | null;
  qrPayload?: string | null;
  checkoutUrl?: string | null;
  deeplink?: string | null;
  expiresAt?: string | null;
  balance: number;
  order?: {
    code: string;
    status: string;
    quantity: number;
    subtotalAmount?: number;
    discountAmount?: number;
    totalAmount: number;
    deliveryText?: string | null;
    product: { id: string; name: string; deliveryType: Product["deliveryType"] };
  } | null;
};

export type History = {
  orders: Array<{
    code: string;
    subtotalAmount?: number;
    discountAmount?: number;
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
    const controller = new AbortController();
    const timeoutMs = isPaymentCreationPath(path) ? 45000 : 8000;
    const timeout = window.setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await fetch(`${API_BASE_URL}${path}`, {
        method,
        cache: method === "GET" ? "no-store" : "default",
        signal: controller.signal,
        headers: {
          "content-type": "application/json",
          ...(method === "GET" ? { "cache-control": "no-cache" } : {}),
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
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") {
        throw new Error(`API request timed out: ${API_BASE_URL}${path}`);
      }
      if (error instanceof TypeError) {
        throw new Error("Không thể kết nối tới hệ thống. Vui lòng thử lại.");
      }
      throw error;
    } finally {
      window.clearTimeout(timeout);
    }
  }
}

function isPaymentCreationPath(path: string) {
  return (
    path === "/store/topups" ||
    path === "/store/orders/bank" ||
    path === "/store/orders/usdt" ||
    path === "/store/cart/orders/bank" ||
    path === "/store/cart/orders/usdt"
  );
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

export function formatUsdt(amount: string | number | null | undefined) {
  const value = Number(amount ?? 0);
  return `${value.toLocaleString("en-US", { maximumFractionDigits: 8 })} USDT`;
}
