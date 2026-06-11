import { Injectable } from "@nestjs/common";
import { BetaAnalyticsDataClient } from "@google-analytics/data";
import { existsSync } from "node:fs";

type AnalyticsRange = "7d" | "30d" | "90d";
type CacheEntry<T> = {
  value: T;
  expiresAt: number;
};

type ReportRow = {
  dimensionValues?: Array<{ value?: string | null } | null>;
  metricValues?: Array<{ value?: string | null } | null>;
};

type Report = {
  rows?: ReportRow[] | null;
  totals?: ReportRow[] | null;
};

const OVERVIEW_TTL_MS = 5 * 60_000;
const REALTIME_TTL_MS = 60_000;
const GOOGLE_TIMEOUT_MS = 4_000;

@Injectable()
export class AnalyticsService {
  private readonly propertyId = process.env.GA_PROPERTY_ID?.trim() || "249898520";
  private readonly credentialsPath =
    process.env.GOOGLE_APPLICATION_CREDENTIALS?.trim() || "/etc/vd-store/google-analytics-service-account.json";
  private readonly configured = Boolean(this.propertyId && this.credentialsPath && existsSync(this.credentialsPath));
  private readonly client = this.configured ? new BetaAnalyticsDataClient() : null;
  private readonly overviewCache = new Map<AnalyticsRange, CacheEntry<ReturnType<typeof emptyOverview>>>();
  private realtimeCache?: CacheEntry<ReturnType<typeof emptyRealtime>>;

  async overview(rawRange?: string) {
    const range = normalizeRange(rawRange);
    if (!this.configured || !this.client) {
      return { ...emptyOverview(range), status: "not_configured" as const };
    }

    const cached = this.overviewCache.get(range);
    if (cached && cached.expiresAt > Date.now()) {
      return { ...cached.value, cached: true };
    }

    try {
      const [response] = await withTimeout(
        this.client.batchRunReports({
          property: `properties/${this.propertyId}`,
          requests: overviewRequests(range)
        }),
        GOOGLE_TIMEOUT_MS
      );
      const reports = (response.reports ?? []) as Report[];
      const value = buildOverview(range, reports);
      this.overviewCache.set(range, { value, expiresAt: Date.now() + OVERVIEW_TTL_MS });
      return value;
    } catch (error) {
      if (cached) {
        return {
          ...cached.value,
          status: "stale" as const,
          cached: true,
          stale: true,
          warning: analyticsErrorMessage(error)
        };
      }
      return {
        ...emptyOverview(range),
        status: "unavailable" as const,
        warning: analyticsErrorMessage(error)
      };
    }
  }

  async realtime() {
    if (!this.configured || !this.client) {
      return { ...emptyRealtime(), status: "not_configured" as const };
    }

    const cached = this.realtimeCache;
    if (cached && cached.expiresAt > Date.now()) {
      return { ...cached.value, cached: true };
    }

    try {
      const [response] = await withTimeout(
        this.client.runRealtimeReport({
          property: `properties/${this.propertyId}`,
          metrics: [{ name: "activeUsers" }]
        }),
        GOOGLE_TIMEOUT_MS
      );
      const value = {
        ...emptyRealtime(),
        status: "ready" as const,
        generatedAt: new Date().toISOString(),
        activeUsers: metric((response.totals?.[0] ?? response.rows?.[0]) as ReportRow | undefined, 0)
      };
      this.realtimeCache = { value, expiresAt: Date.now() + REALTIME_TTL_MS };
      return value;
    } catch (error) {
      if (cached) {
        return {
          ...cached.value,
          status: "stale" as const,
          cached: true,
          stale: true,
          warning: analyticsErrorMessage(error)
        };
      }
      return {
        ...emptyRealtime(),
        status: "unavailable" as const,
        warning: analyticsErrorMessage(error)
      };
    }
  }
}

function overviewRequests(range: AnalyticsRange) {
  const dateRanges = [{ startDate: rangeStart(range), endDate: "today" }];
  return [
    {
      dateRanges,
      metrics: [
        { name: "activeUsers" },
        { name: "newUsers" },
        { name: "sessions" },
        { name: "screenPageViews" },
        { name: "engagementRate" }
      ]
    },
    {
      dateRanges,
      dimensions: [{ name: "date" }],
      metrics: [{ name: "activeUsers" }, { name: "sessions" }, { name: "screenPageViews" }],
      orderBys: [{ dimension: { dimensionName: "date" } }]
    },
    {
      dateRanges,
      dimensions: [{ name: "sessionDefaultChannelGroup" }],
      metrics: [{ name: "sessions" }, { name: "activeUsers" }],
      orderBys: [{ metric: { metricName: "sessions" }, desc: true }],
      limit: 8
    },
    {
      dateRanges,
      dimensions: [{ name: "pagePathPlusQueryString" }, { name: "pageTitle" }],
      metrics: [{ name: "screenPageViews" }, { name: "activeUsers" }],
      orderBys: [{ metric: { metricName: "screenPageViews" }, desc: true }],
      limit: 10
    },
    {
      dateRanges,
      dimensions: [{ name: "itemName" }],
      metrics: [{ name: "itemsViewed" }, { name: "itemsAddedToCart" }, { name: "itemsCheckedOut" }, { name: "itemsPurchased" }],
      orderBys: [{ metric: { metricName: "itemsViewed" }, desc: true }],
      limit: 10
    },
    {
      dateRanges,
      dimensions: [{ name: "deviceCategory" }],
      metrics: [{ name: "activeUsers" }],
      orderBys: [{ metric: { metricName: "activeUsers" }, desc: true }]
    },
    {
      dateRanges,
      dimensions: [{ name: "country" }],
      metrics: [{ name: "activeUsers" }],
      orderBys: [{ metric: { metricName: "activeUsers" }, desc: true }],
      limit: 10
    },
    {
      dateRanges,
      dimensions: [{ name: "eventName" }],
      metrics: [{ name: "eventCount" }],
      dimensionFilter: {
        filter: {
          fieldName: "eventName",
          inListFilter: {
            values: ["view_item", "add_to_cart", "begin_checkout", "purchase"]
          }
        }
      }
    }
  ];
}

function buildOverview(range: AnalyticsRange, reports: Report[]) {
  const summary = reports[0]?.totals?.[0] ?? reports[0]?.rows?.[0];
  const funnelMap = new Map((reports[7]?.rows ?? []).map((row) => [dimension(row, 0), metric(row, 0)]));

  return {
    ...emptyOverview(range),
    status: "ready" as const,
    generatedAt: new Date().toISOString(),
    summary: {
      activeUsers: metric(summary, 0),
      newUsers: metric(summary, 1),
      sessions: metric(summary, 2),
      views: metric(summary, 3),
      engagementRate: metricFloat(summary, 4)
    },
    trend: (reports[1]?.rows ?? []).map((row) => ({
      date: dimension(row, 0),
      activeUsers: metric(row, 0),
      sessions: metric(row, 1),
      views: metric(row, 2)
    })),
    sources: (reports[2]?.rows ?? []).map((row) => ({
      name: dimension(row, 0) || "Unassigned",
      sessions: metric(row, 0),
      users: metric(row, 1)
    })),
    pages: (reports[3]?.rows ?? []).map((row) => ({
      path: dimension(row, 0) || "/",
      title: dimension(row, 1) || dimension(row, 0) || "/",
      views: metric(row, 0),
      users: metric(row, 1)
    })),
    products: (reports[4]?.rows ?? [])
      .filter((row) => Boolean(dimension(row, 0)) && dimension(row, 0) !== "(not set)")
      .map((row) => ({
        name: dimension(row, 0),
        views: metric(row, 0),
        cartAdds: metric(row, 1),
        checkouts: metric(row, 2),
        purchases: metric(row, 3)
      })),
    devices: (reports[5]?.rows ?? []).map((row) => ({
      name: dimension(row, 0) || "unknown",
      users: metric(row, 0)
    })),
    countries: (reports[6]?.rows ?? []).map((row) => ({
      name: dimension(row, 0) || "Unknown",
      users: metric(row, 0)
    })),
    funnel: [
      { key: "view_item", label: "Xem sản phẩm", count: funnelMap.get("view_item") ?? 0 },
      { key: "add_to_cart", label: "Thêm vào giỏ", count: funnelMap.get("add_to_cart") ?? 0 },
      { key: "begin_checkout", label: "Bắt đầu thanh toán", count: funnelMap.get("begin_checkout") ?? 0 },
      { key: "purchase", label: "Mua thành công", count: funnelMap.get("purchase") ?? 0 }
    ]
  };
}

function emptyOverview(range: AnalyticsRange) {
  return {
    status: "ready" as "ready" | "stale" | "not_configured" | "unavailable",
    range,
    generatedAt: null as string | null,
    cached: false,
    stale: false,
    warning: null as string | null,
    summary: { activeUsers: 0, newUsers: 0, sessions: 0, views: 0, engagementRate: 0 },
    trend: [] as Array<{ date: string; activeUsers: number; sessions: number; views: number }>,
    sources: [] as Array<{ name: string; sessions: number; users: number }>,
    pages: [] as Array<{ path: string; title: string; views: number; users: number }>,
    products: [] as Array<{ name: string; views: number; cartAdds: number; checkouts: number; purchases: number }>,
    devices: [] as Array<{ name: string; users: number }>,
    countries: [] as Array<{ name: string; users: number }>,
    funnel: [
      { key: "view_item", label: "Xem sản phẩm", count: 0 },
      { key: "add_to_cart", label: "Thêm vào giỏ", count: 0 },
      { key: "begin_checkout", label: "Bắt đầu thanh toán", count: 0 },
      { key: "purchase", label: "Mua thành công", count: 0 }
    ]
  };
}

function emptyRealtime() {
  return {
    status: "ready" as "ready" | "stale" | "not_configured" | "unavailable",
    generatedAt: null as string | null,
    activeUsers: 0,
    cached: false,
    stale: false,
    warning: null as string | null
  };
}

function normalizeRange(value?: string): AnalyticsRange {
  return value === "7d" || value === "90d" ? value : "30d";
}

function rangeStart(range: AnalyticsRange) {
  if (range === "7d") return "6daysAgo";
  if (range === "90d") return "89daysAgo";
  return "29daysAgo";
}

function dimension(row: ReportRow | undefined, index: number) {
  return row?.dimensionValues?.[index]?.value ?? "";
}

function metric(row: ReportRow | undefined, index: number) {
  return Math.round(Number(row?.metricValues?.[index]?.value ?? 0) || 0);
}

function metricFloat(row: ReportRow | undefined, index: number) {
  return Number(row?.metricValues?.[index]?.value ?? 0) || 0;
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number) {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error("Google Analytics request timed out.")), timeoutMs);
      })
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function analyticsErrorMessage(error: unknown) {
  const message = error instanceof Error ? error.message : "Không thể tải dữ liệu Google Analytics.";
  return message.length > 180 ? `${message.slice(0, 177)}...` : message;
}
