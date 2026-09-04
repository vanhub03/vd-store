const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? resolveDefaultApiBaseUrl();

function resolveDefaultApiBaseUrl() {
  if (typeof window !== "undefined" && window.location.hostname === "admin.vanhdao.io.vn") {
    return "https://api.vanhdao.io.vn";
  }
  return "http://localhost:3000";
}

export type AdminSession = {
  token: string;
  admin: { id: string; email: string; name?: string; role: string };
};

export class Api {
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

  postForm<T>(path: string, body: FormData) {
    return this.request<T>("POST", path, body);
  }

  put<T>(path: string, body?: unknown) {
    return this.request<T>("PUT", path, body);
  }

  delete<T>(path: string) {
    return this.request<T>("DELETE", path);
  }

  private async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const isFormData = body instanceof FormData;
    const response = await fetch(`${API_BASE_URL}${path}`, {
      method,
      headers: {
        ...(isFormData ? {} : { "content-type": "application/json" }),
        ...(this.token ? { authorization: `Bearer ${this.token}` } : {})
      },
      body: body === undefined ? undefined : isFormData ? body : JSON.stringify(body)
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

export function formatVnd(amount: number) {
  return new Intl.NumberFormat("vi-VN", {
    style: "currency",
    currency: "VND",
    maximumFractionDigits: 0
  }).format(amount);
}
