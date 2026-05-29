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
      const html = await fetchText(config.webUrl);
      const assetPathsToCheck = [...assetPaths(html, "js"), ...assetPaths(html, "css")];
      if (assetPathsToCheck.length === 0) throw new Error("Could not find storefront assets.");
      const bundle = (
        await Promise.all(assetPathsToCheck.map((path) => fetchText(new URL(path, config.webUrl).toString())))
      ).join("\n");
      const requiredMarkers = ["hero-motion", "orbit", "signal-board", "ledger-rail", "trust-grid", "brand-panel", "reveal"];
      const missing = requiredMarkers.filter((marker) => !bundle.includes(marker));
      if (missing.length > 0) {
        throw new Error(`Missing landing animation marker(s): ${missing.join(", ")}.`);
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
