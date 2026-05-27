export class ApiClient {
  constructor(
    private readonly baseUrl = process.env.API_BASE_URL ?? "http://localhost:3000",
    private readonly botToken = process.env.BOT_INTERNAL_TOKEN ?? ""
  ) {}

  get<T>(path: string) {
    return this.request<T>("GET", path);
  }

  post<T>(path: string, body?: unknown) {
    return this.request<T>("POST", path, body);
  }

  private async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const response = await fetch(`${this.baseUrl}${path}`, {
      method,
      headers: {
        "content-type": "application/json",
        "x-bot-token": this.botToken
      },
      body: body === undefined ? undefined : JSON.stringify(body)
    });

    const text = await response.text();
    const data = text ? JSON.parse(text) : null;
    if (!response.ok) {
      const message = data?.message ?? data?.error ?? `API error ${response.status}`;
      throw new Error(Array.isArray(message) ? message.join(", ") : message);
    }
    return data as T;
  }
}

export type CatalogResponse = {
  categories: Array<{
    id: string;
    name: string;
    products: ProductSummary[];
  }>;
  uncategorized: ProductSummary[];
};

export type ProductSummary = {
  id: string;
  name: string;
  description?: string;
  imageUrl?: string | null;
  price: number;
  deliveryType: string;
  manualStock?: number;
  category?: { id: string; name: string } | null;
  _count?: { inventoryItems: number };
};

export type ProductDetail = ProductSummary & {
  sharedContent?: string;
  manualInstructions?: string;
};

export type PaymentResponse = {
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

export type WalletPurchaseResponse = {
  deliveryText: string;
  balanceAfter: number;
};

export type HistoryResponse = {
  orders: Array<{
    code: string;
    totalAmount: number;
    status: string;
    createdAt: string;
    product: { name: string };
  }>;
  ledger: Array<{
    amount: number;
    type: string;
    note?: string;
    createdAt: string;
  }>;
};
