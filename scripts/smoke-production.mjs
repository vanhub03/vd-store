const DEFAULTS = {
  webUrl: "https://www.vanhdao.io.vn",
  adminUrl: "https://admin.vanhdao.io.vn",
  apiUrl: "https://api.vanhdao.io.vn"
};

const config = {
  webUrl: process.env.SMOKE_WEB_URL ?? DEFAULTS.webUrl,
  adminUrl: process.env.SMOKE_ADMIN_URL ?? DEFAULTS.adminUrl,
  apiUrl: process.env.SMOKE_API_URL ?? DEFAULTS.apiUrl,
  timeoutMs: Number(process.env.SMOKE_TIMEOUT_MS ?? 120_000)
};

const checks = [
  {
    name: "storefront html",
    run: async () => {
      const response = await fetchWithTimeout(config.webUrl);
      assertStatus(response, 200);
      const body = await response.text();
      assertIncludes(body, "<div id=\"root\">", "storefront root element");
      return `HTTP ${response.status}`;
    }
  },
  {
    name: "admin html",
    run: async () => {
      const response = await fetchWithTimeout(config.adminUrl);
      assertStatus(response, 200);
      const body = await response.text();
      assertIncludes(body, "<div id=\"root\">", "admin root element");
      return `HTTP ${response.status}`;
    }
  },
  {
    name: "api health",
    run: async () => {
      const response = await fetchWithTimeout(`${config.apiUrl}/health`);
      assertStatus(response, 200);
      const body = await response.json();
      if (body?.ok !== true || body?.service !== "vd-store-api") {
        throw new Error(`Unexpected health payload: ${JSON.stringify(body)}`);
      }
      return body.timestamp;
    }
  },
  {
    name: "public web catalog",
    run: async () => {
      const response = await fetchWithTimeout(`${config.apiUrl}/store/catalog`);
      assertStatus(response, 200);
      const catalog = await response.json();
      if (!Array.isArray(catalog?.categories)) {
        throw new Error("Catalog payload does not include categories.");
      }
      const products = [
        ...catalog.categories.flatMap((category) => category.products ?? []),
        ...(Array.isArray(catalog.uncategorized) ? catalog.uncategorized : [])
      ];
      if (products.length === 0) {
        throw new Error("Public web catalog has no products.");
      }
      for (const product of products) {
        if (product.showInWeb === false) {
          throw new Error(`Catalog includes product hidden from web: ${product.name ?? product.id}`);
        }
      }
      return `${products.length} product(s)`;
    }
  },
  {
    name: "customer auth guard",
    run: async () => {
      const response = await fetchWithTimeout(`${config.apiUrl}/store/me`);
      if (response.status !== 401) {
        throw new Error(`Expected 401 for /store/me without token, got ${response.status}.`);
      }
      return "401 without token";
    }
  },
  {
    name: "protected storefront payment endpoints",
    run: async () => {
      const probes = [
        { method: "GET", path: "/store/wallet" },
        { method: "GET", path: "/store/history" },
        { method: "GET", path: "/store/payments/DHSMOKE" },
        { method: "POST", path: "/store/topups", body: { amount: 1000 } },
        { method: "POST", path: "/store/topups/usdt", body: { amount: 1000 } },
        { method: "POST", path: "/store/orders/wallet", body: { productId: "smoke-product", quantity: 1 } },
        { method: "POST", path: "/store/orders/bank", body: { productId: "smoke-product", quantity: 1 } }
      ];
      const failures = [];
      for (const probe of probes) {
        const response = await fetchWithTimeout(`${config.apiUrl}${probe.path}`, {
          method: probe.method,
          headers: probe.body ? { "content-type": "application/json" } : undefined,
          body: probe.body ? JSON.stringify(probe.body) : undefined
        });
        if (response.status !== 401) {
          failures.push(`${probe.method} ${probe.path}: ${response.status}`);
        }
      }
      if (failures.length > 0) {
        throw new Error(`Expected 401 without token: ${failures.join(", ")}`);
      }
      return `${probes.length} endpoint(s)`;
    }
  },
  {
    name: "partner api rejects missing credentials with problem details",
    run: async () => {
      const response = await fetchWithTimeout(`${config.apiUrl}/partner/v1/catalog`);
      if (response.status !== 401) throw new Error(`Expected 401 without Partner API key, got ${response.status}.`);
      const body = await response.json();
      if (body?.code !== "missing_api_key" || body?.status !== 401 || !body?.requestId) {
        throw new Error(`Unexpected Partner API problem response: ${JSON.stringify(body)}`);
      }
      return "401 application/problem+json";
    }
  },
  {
    name: "partner openapi contract",
    run: async () => {
      const response = await fetchWithTimeout(`${config.apiUrl}/partner/openapi.json`);
      assertStatus(response, 200);
      const document = await response.json();
      const paths = Object.keys(document?.paths ?? {});
      const required = ["/partner/v1/catalog", "/partner/v1/balance", "/partner/v1/orders", "/partner/v1/orders/{id}"];
      const missing = required.filter((path) => !paths.includes(path));
      const unrelated = paths.filter((path) => !path.startsWith("/partner/v1"));
      if (missing.length || unrelated.length) throw new Error(`Unexpected Partner OpenAPI paths. Missing: ${missing.join(", ")}; unrelated: ${unrelated.join(", ")}`);
      return `${paths.length} partner path(s)`;
    }
  },
  {
    name: "sepay webhook rejects unsigned requests",
    run: async () => {
      const response = await fetchWithTimeout(`${config.apiUrl}/webhooks/sepay`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          id: "SMOKE_UNSIGNED",
          gateway: "TPBank",
          accountNumber: "03219071601",
          content: "NAPSMOKE",
          transferType: "in",
          transferAmount: 1000
        })
      });
      if (response.status !== 401) {
        throw new Error(`Expected 401 for unsigned SePay webhook, got ${response.status}.`);
      }
      return "401 unsigned";
    }
  },
  {
    name: "storefront css does not use gradient tokens",
    run: async () => {
      const html = await fetchText(config.webUrl);
      const cssPaths = assetPaths(html, "css");
      if (cssPaths.length === 0) throw new Error("Could not find storefront CSS asset.");
      for (const path of cssPaths) {
        const cssUrl = new URL(path, config.webUrl).toString();
        const css = await fetchText(cssUrl);
        if (/(linear-gradient|radial-gradient|conic-gradient)/i.test(css)) {
          throw new Error(`Gradient token found in ${cssUrl}.`);
        }
      }
      return `${cssPaths.length} css asset(s)`;
    }
  },
  {
    name: "storefront landing animation markers",
    run: async () => {
      const bundle = await storefrontBundleText();
      const requiredMarkers = [
        "hero-showcase",
        "floating-product-card",
        "energy-line",
        "is-orbit-paused",
        "orbitSpin",
        "reveal"
      ];
      const missing = requiredMarkers.filter((marker) => !bundle.includes(marker));
      if (missing.length > 0) {
        throw new Error(`Missing landing animation marker(s): ${missing.join(", ")}.`);
      }
      return `${requiredMarkers.length} marker(s)`;
    }
  },
  {
    name: "storefront wallet and QR purchase flow markers",
    run: async () => {
      const bundle = await storefrontBundleText();
      const requiredMarkers = [
        "/store/topups",
        "/store/topups/usdt",
        "/store/orders/wallet",
        "/store/orders/bank",
        "/store/payments/",
        "CREDITED_TO_WALLET",
        "MANUAL_REVIEW",
        "EXPIRED",
        "FAILED"
      ];
      const missing = requiredMarkers.filter((marker) => !bundle.includes(marker));
      if (missing.length > 0) {
        throw new Error(`Missing storefront payment marker(s): ${missing.join(", ")}.`);
      }
      return `${requiredMarkers.length} marker(s)`;
    }
  }
];

const startedAt = Date.now();
const failures = [];

for (const check of checks) {
  const checkStartedAt = Date.now();
  try {
    const detail = await check.run();
    const ms = Date.now() - checkStartedAt;
    console.log(`PASS ${check.name} (${ms}ms) ${detail}`);
  } catch (error) {
    const ms = Date.now() - checkStartedAt;
    failures.push({ check: check.name, error });
    console.error(`FAIL ${check.name} (${ms}ms) ${(error instanceof Error ? error.message : String(error))}`);
  }
}

const totalMs = Date.now() - startedAt;
if (failures.length > 0) {
  console.error(`Production smoke failed: ${failures.length}/${checks.length} check(s), ${totalMs}ms total.`);
  process.exitCode = 1;
} else {
  console.log(`Production smoke passed: ${checks.length}/${checks.length} check(s), ${totalMs}ms total.`);
}

async function fetchWithTimeout(url, options = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), config.timeoutMs);
  try {
    return await fetch(url, {
      redirect: "follow",
      ...options,
      signal: controller.signal
    });
  } finally {
    clearTimeout(timeout);
  }
}

async function fetchText(url) {
  const response = await fetchWithTimeout(url);
  assertStatus(response, 200);
  return response.text();
}

function assertStatus(response, expected) {
  if (response.status !== expected) {
    throw new Error(`Expected HTTP ${expected}, got ${response.status} for ${response.url}.`);
  }
}

function assertIncludes(input, needle, label) {
  if (!input.includes(needle)) {
    throw new Error(`Missing ${label}.`);
  }
}

function assetPaths(html, extension) {
  const pattern = new RegExp(`(?:href|src)="([^"]+\\.${extension})"`, "g");
  return [...html.matchAll(pattern)].map((match) => match[1]);
}

async function storefrontBundleText() {
  const html = await fetchText(config.webUrl);
  const assetPathsToCheck = [...assetPaths(html, "js"), ...assetPaths(html, "css")];
  if (assetPathsToCheck.length === 0) throw new Error("Could not find storefront assets.");
  return (
    await Promise.all(assetPathsToCheck.map((path) => fetchText(new URL(path, config.webUrl).toString())))
  ).join("\n");
}
