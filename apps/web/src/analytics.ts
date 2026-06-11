const MEASUREMENT_ID = import.meta.env.VITE_GA_MEASUREMENT_ID?.trim() || "G-CFYXXY4CYJ";
const CONSENT_KEY = "vd_store_analytics_consent";
const PURCHASES_KEY = "vd_store_analytics_purchases";

export type AnalyticsConsent = "granted" | "denied" | "unset";

export type AnalyticsItem = {
  item_id: string;
  item_name: string;
  item_category?: string;
  quantity: number;
};

declare global {
  interface Window {
    dataLayer?: unknown[];
    gtag?: (...args: unknown[]) => void;
  }
}

let loadPromise: Promise<boolean> | null = null;

export function analyticsAvailable() {
  return Boolean(MEASUREMENT_ID);
}

export function readAnalyticsConsent(): AnalyticsConsent {
  if (!analyticsAvailable()) return "denied";
  const saved = localStorage.getItem(CONSENT_KEY);
  return saved === "granted" || saved === "denied" ? saved : "unset";
}

export function updateAnalyticsConsent(consent: Exclude<AnalyticsConsent, "unset">) {
  localStorage.setItem(CONSENT_KEY, consent);
  if (consent === "granted") {
    void ensureAnalyticsLoaded();
  } else {
    window.gtag?.("consent", "update", { analytics_storage: "denied" });
    clearAnalyticsCookies();
  }
}

export function trackPageView(pagePath: string, pageTitle: string) {
  track("page_view", {
    page_path: pagePath,
    page_location: `${window.location.origin}${pagePath}`,
    page_title: pageTitle
  });
}

export function trackViewItem(item: AnalyticsItem) {
  track("view_item", { items: [item] });
}

export function trackAddToCart(item: AnalyticsItem) {
  track("add_to_cart", { items: [item] });
}

export function trackViewCart(items: AnalyticsItem[]) {
  if (items.length) track("view_cart", { items });
}

export function trackBeginCheckout(items: AnalyticsItem[]) {
  if (items.length) track("begin_checkout", { items });
}

export function trackPaymentInfo(paymentType: string, items: AnalyticsItem[]) {
  if (items.length) {
    track("add_payment_info", {
      payment_type: paymentType,
      items
    });
  }
}

export function trackPurchaseOnce(transactionId: string, items: AnalyticsItem[]) {
  const cleanId = transactionId.trim();
  if (!cleanId || !items.length || hasTrackedPurchase(cleanId)) return;
  if (readAnalyticsConsent() !== "granted") return;
  void ensureAnalyticsLoaded().then((loaded) => {
    if (!loaded || hasTrackedPurchase(cleanId)) return;
    window.gtag?.("event", "purchase", {
      transaction_id: cleanId,
      items
    });
    markPurchaseTracked(cleanId);
  });
}

function track(eventName: string, parameters: Record<string, unknown>) {
  if (readAnalyticsConsent() !== "granted") return;
  void ensureAnalyticsLoaded().then((loaded) => {
    if (!loaded) return;
    window.gtag?.("event", eventName, parameters);
  });
}

function ensureAnalyticsLoaded(): Promise<boolean> {
  if (!analyticsAvailable() || readAnalyticsConsent() !== "granted") {
    return Promise.resolve(false);
  }
  if (window.gtag) return Promise.resolve(true);
  if (loadPromise) return loadPromise;

  loadPromise = new Promise<boolean>((resolve) => {
    window.dataLayer = window.dataLayer ?? [];
    window.gtag = (...args: unknown[]) => {
      window.dataLayer?.push(args);
    };
    window.gtag("js", new Date());
    window.gtag("config", MEASUREMENT_ID, {
      send_page_view: false,
      allow_google_signals: false,
      allow_ad_personalization_signals: false
    });

    const script = document.createElement("script");
    script.async = true;
    script.src = `https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(MEASUREMENT_ID)}`;
    script.dataset.vdAnalytics = "true";
    script.addEventListener("load", () => resolve(true), { once: true });
    script.addEventListener(
      "error",
      () => {
        window.gtag = undefined;
        loadPromise = null;
        resolve(false);
      },
      { once: true }
    );
    document.head.appendChild(script);
  });

  return loadPromise;
}

function hasTrackedPurchase(transactionId: string) {
  return readTrackedPurchases().includes(transactionId);
}

function markPurchaseTracked(transactionId: string) {
  const purchases = [transactionId, ...readTrackedPurchases().filter((id) => id !== transactionId)].slice(0, 100);
  localStorage.setItem(PURCHASES_KEY, JSON.stringify(purchases));
}

function readTrackedPurchases(): string[] {
  try {
    const value = JSON.parse(localStorage.getItem(PURCHASES_KEY) ?? "[]");
    return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
  } catch {
    return [];
  }
}

function clearAnalyticsCookies() {
  document.cookie.split(";").forEach((part) => {
    const name = part.split("=")[0]?.trim();
    if (!name || (name !== "_ga" && !name.startsWith("_ga_"))) return;
    document.cookie = `${name}=; Max-Age=0; path=/; SameSite=Lax`;
  });
}
