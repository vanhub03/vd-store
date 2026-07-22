import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

const SITE_ORIGIN = "https://www.vanhdao.io.vn";
const API_ORIGIN = (process.env.SEO_API_BASE_URL || process.env.VITE_API_BASE_URL || "https://api.vanhdao.io.vn").replace(/\/+$/, "");
const DIST = resolve(process.cwd(), "dist");
const BASE_HTML_PATH = resolve(DIST, "index.html");
const today = new Date().toISOString().slice(0, 10);

const [catalog, reviewResult] = await Promise.all([
  fetchJson(`${API_ORIGIN}/store/catalog`),
  fetchJson(`${API_ORIGIN}/store/reviews`).catch((error) => {
    console.warn(`SEO reviews unavailable: ${error.message}`);
    return { reviews: [] };
  })
]);

if (!Array.isArray(catalog?.categories) || !Array.isArray(catalog?.uncategorized)) {
  throw new Error(`Invalid catalog response from ${API_ORIGIN}/store/catalog`);
}

const baseHtml = readFileSync(BASE_HTML_PATH, "utf8");
const categories = catalog.categories;
const products = [
  ...categories.flatMap((category) => category.products.map((product) => ({ ...product, category: { id: category.id, name: category.name } }))),
  ...catalog.uncategorized
];
const reviews = Array.isArray(reviewResult?.reviews) ? reviewResult.reviews : [];

const homeBody = pageShell({
  eyebrow: "VD AI Shop",
  title: "Tài khoản AI, phần mềm premium và dịch vụ số",
  description: "Mua sản phẩm số với VietQR, ví nội bộ hoặc USDT. Xem danh mục và sản phẩm đang có tại VD AI Shop.",
  content: `${navigation()}
    <h2>Danh mục đang bán</h2>
    ${linkGrid(categories.map((category) => ({ href: categoryPath(category), title: category.name, text: `${category.products.length} sản phẩm` })))}
    <h2>Sản phẩm nổi bật</h2>
    ${productGrid(products.slice(0, 12))}`
});

writePage(
  "/",
  buildDocument(baseHtml, {
    title: "Vanhdao.io.vn | VD AI Shop - Tài khoản AI và phần mềm",
    description: "Mua ChatGPT Plus, Claude Pro, Gemini Advanced, Canva Pro, Adobe, YouTube Premium và dịch vụ số tại VD AI Shop.",
    canonicalPath: "/",
    body: homeBody,
    structuredData: itemListStructuredData("Sản phẩm nổi bật tại VD AI Shop", products.slice(0, 12))
  })
);

writePage(
  "/san-pham",
  buildDocument(baseHtml, {
    title: "Kho sản phẩm AI & phần mềm Premium | VD AI Shop",
    description: `Khám phá ${products.length} sản phẩm AI, tài khoản premium, key phần mềm và dịch vụ số đang bán tại VD AI Shop.`,
    canonicalPath: "/san-pham",
    body: pageShell({
      eyebrow: "Danh sách sản phẩm",
      title: "Kho sản phẩm AI & Premium",
      description: "Tìm sản phẩm phù hợp và xem thông tin giao hàng, giá bán, tình trạng kho.",
      content: `${navigation()}${productGrid(products)}`
    }),
    structuredData: itemListStructuredData("Kho sản phẩm VD AI Shop", products)
  })
);

writePage(
  "/danh-gia",
  buildDocument(baseHtml, {
    title: "Đánh giá khách hàng | VD AI Shop",
    description: "Xem đánh giá thực tế của khách hàng về tài khoản AI, phần mềm premium và chất lượng giao hàng tại VD AI Shop.",
    canonicalPath: "/danh-gia",
    body: pageShell({
      eyebrow: "Khách hàng nói gì",
      title: "Đánh giá khách hàng",
      description: "Những trải nghiệm mua hàng được khách hàng chia sẻ trên VD AI Shop.",
      content: `${navigation()}${reviewGrid(reviews)}`
    }),
    structuredData: {
      "@context": "https://schema.org",
      "@type": "CollectionPage",
      name: "Đánh giá khách hàng VD AI Shop",
      url: `${SITE_ORIGIN}/danh-gia`
    }
  })
);

for (const category of categories) {
  const path = categoryPath(category);
  writePage(
    path,
    buildDocument(baseHtml, {
      title: `${category.name} - Sản phẩm và bảng giá | VD AI Shop`,
      description: `Xem ${category.products.length} sản phẩm ${category.name}, giá bán, hình thức giao hàng và tình trạng kho tại VD AI Shop.`,
      canonicalPath: path,
      image: category.products.find((product) => product.imageUrl)?.imageUrl,
      body: pageShell({
        eyebrow: "Danh mục sản phẩm",
        title: category.name,
        description: `${category.products.length} sản phẩm đang hiển thị trong danh mục ${category.name}.`,
        content: `${navigation()}${productGrid(category.products.map((product) => ({ ...product, category: { id: category.id, name: category.name } })))}`
      }),
      structuredData: itemListStructuredData(`Danh mục ${category.name}`, category.products)
    })
  );
}

for (const product of products) {
  const path = productPath(product);
  const description = productSeoDescription(product);
  writePage(
    path,
    buildDocument(baseHtml, {
      title: `${product.name} - Giá và thông tin sản phẩm | VD AI Shop`,
      description,
      canonicalPath: path,
      image: product.imageUrl,
      body: productPage(product),
      structuredData: productStructuredData(product)
    })
  );
}

writeSitemap(["/", "/san-pham", "/danh-gia", ...categories.map(categoryPath), ...products.map(productPath)]);
console.log(`SEO prerender complete: ${categories.length} categories, ${products.length} products, ${reviews.length} reviews.`);

async function fetchJson(url) {
  const response = await fetch(url, {
    headers: { accept: "application/json", "user-agent": "vd-store-seo-build/1.0" },
    signal: AbortSignal.timeout(20000)
  });
  if (!response.ok) throw new Error(`${url} returned HTTP ${response.status}`);
  return response.json();
}

function seoSlug(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/đ/gi, "d")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80) || "san-pham";
}

function entitySuffix(id) {
  return String(id || "").toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 8) || "item";
}

function productPath(product) {
  return `/san-pham/${seoSlug(product.name)}-${entitySuffix(product.id)}`;
}

function categoryPath(category) {
  return `/danh-muc/${seoSlug(category.name)}-${entitySuffix(category.id)}`;
}

function buildDocument(html, { title, description, canonicalPath, image, body, structuredData }) {
  const canonical = `${SITE_ORIGIN}${canonicalPath === "/" ? "/" : canonicalPath}`;
  const socialImage = absoluteImage(image) || `${SITE_ORIGIN}/social-card.png`;
  let output = html
    .replace(/\s*<script\s+id="vd-page-structured-data"[\s\S]*?<\/script>/gi, "")
    .replace(/\s*<noscript>[\s\S]*?<\/noscript>/i, "")
    .replace(/<title>[\s\S]*?<\/title>/i, `<title>${escapeHtml(title)}</title>`)
    .replace(/<meta\s+name="description"[\s\S]*?\/>/i, `<meta name="description" content="${escapeHtml(description)}" />`)
    .replace(/<meta\s+name="robots"[\s\S]*?\/>/i, '<meta name="robots" content="index, follow, max-image-preview:large" />')
    .replace(/<link\s+rel="canonical"[\s\S]*?\/>/i, `<link rel="canonical" href="${canonical}" />`)
    .replace(/<meta\s+property="og:title"[\s\S]*?\/>/i, `<meta property="og:title" content="${escapeHtml(title)}" />`)
    .replace(/<meta\s+property="og:description"[\s\S]*?\/>/i, `<meta property="og:description" content="${escapeHtml(description)}" />`)
    .replace(/<meta\s+property="og:url"[\s\S]*?\/>/i, `<meta property="og:url" content="${canonical}" />`)
    .replace(/<meta\s+property="og:image"[\s\S]*?\/>/i, `<meta property="og:image" content="${escapeHtml(socialImage)}" />`)
    .replace(/<meta\s+property="og:image:secure_url"[\s\S]*?\/>/i, `<meta property="og:image:secure_url" content="${escapeHtml(socialImage)}" />`)
    .replace(/<meta\s+name="twitter:title"[\s\S]*?\/>/i, `<meta name="twitter:title" content="${escapeHtml(title)}" />`)
    .replace(/<meta\s+name="twitter:description"[\s\S]*?\/>/i, `<meta name="twitter:description" content="${escapeHtml(description)}" />`)
    .replace(/<meta\s+name="twitter:image"[\s\S]*?\/>/i, `<meta name="twitter:image" content="${escapeHtml(socialImage)}" />`);

  const jsonLd = JSON.stringify(structuredData).replace(/</g, "\\u003c");
  output = output.replace("</head>", `    <script id="vd-page-structured-data" type="application/ld+json">${jsonLd}</script>\n  </head>`);
  output = output.replace(/<div id="root">[\s\S]*?<\/body>/i, `<div id="root">${body}</div>\n  </body>`);
  return output;
}

function pageShell({ eyebrow, title, description, content }) {
  return `<main style="min-height:100vh;padding:48px 24px;background:#030712;color:#f8fafc;font-family:system-ui,sans-serif">
    <div style="max-width:1180px;margin:0 auto">
      <a href="/" aria-label="VD AI Shop"><img src="/logo.png" width="72" height="72" alt="VD AI Shop" /></a>
      <p style="margin:24px 0 8px;color:#67e8f9;text-transform:uppercase;letter-spacing:.12em;font-weight:700">${escapeHtml(eyebrow)}</p>
      <h1 style="max-width:900px;margin:0 0 12px;font-size:clamp(32px,5vw,56px);line-height:1.1">${escapeHtml(title)}</h1>
      <p style="max-width:820px;color:#cbd5e1;font-size:18px;line-height:1.7">${escapeHtml(description)}</p>
      ${content}
    </div>
  </main>`;
}

function navigation() {
  return `<nav aria-label="Điều hướng chính" style="display:flex;flex-wrap:wrap;gap:20px;margin:28px 0 36px">
    <a href="/" style="color:#67e8f9">Trang chủ</a>
    <a href="/san-pham" style="color:#67e8f9">Sản phẩm</a>
    <a href="/danh-gia" style="color:#67e8f9">Đánh giá</a>
  </nav>`;
}

function linkGrid(items) {
  if (!items.length) return "<p>Danh mục đang được cập nhật.</p>";
  return `<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:16px;margin:20px 0 44px">${items
    .map((item) => `<a href="${item.href}" style="display:block;padding:20px;border:1px solid #334155;border-radius:18px;color:#f8fafc;text-decoration:none;background:#0f172a"><strong>${escapeHtml(item.title)}</strong><br/><span style="color:#94a3b8">${escapeHtml(item.text)}</span></a>`)
    .join("")}</div>`;
}

function productGrid(items) {
  if (!items.length) return "<p>Sản phẩm đang được cập nhật.</p>";
  return `<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:18px;margin-top:28px">${items
    .map((product) => {
      const image = absoluteImage(product.imageUrl);
      const description = truncate(cleanText(product.description) || "Xem giá, tình trạng kho và thông tin giao hàng.", 150);
      return `<article style="padding:18px;border:1px solid #334155;border-radius:20px;background:#0f172a">
        <a href="${productPath(product)}" style="color:#f8fafc;text-decoration:none">
          ${image ? `<img src="${escapeHtml(image)}" alt="${escapeHtml(product.name)}" width="320" height="180" style="width:100%;height:180px;object-fit:cover;border-radius:14px" />` : ""}
          <p style="color:#67e8f9">${escapeHtml(product.category?.name || "Sản phẩm số")}</p>
          <h2 style="font-size:20px">${escapeHtml(product.name)}</h2>
        </a>
        <p style="color:#cbd5e1;line-height:1.6">${escapeHtml(description)}</p>
        <strong>${formatVnd(product.price)}</strong>
      </article>`;
    })
    .join("")}</div>`;
}

function reviewGrid(items) {
  if (!items.length) return "<p>Đánh giá đang được cập nhật.</p>";
  return `<div style="display:grid;gap:16px;margin-top:28px">${items
    .map((review) => `<article style="padding:22px;border:1px solid #334155;border-radius:18px;background:#0f172a">
      <p aria-label="${Number(review.rating) || 5} trên 5 sao" style="color:#fbbf24">${"★".repeat(Math.max(1, Math.min(5, Number(review.rating) || 5)))}</p>
      ${review.title ? `<h2>${escapeHtml(review.title)}</h2>` : ""}
      <p style="color:#cbd5e1;line-height:1.7">${escapeHtml(cleanText(review.content))}</p>
      <small>${escapeHtml(review.author || "Khách hàng")} · ${escapeHtml(review.product?.name || "VD AI Shop")}</small>
    </article>`)
    .join("")}</div>`;
}

function productPage(product) {
  const image = absoluteImage(product.imageUrl);
  const description = cleanText(product.description) || "Thông tin chi tiết sẽ được hiển thị trên website.";
  return pageShell({
    eyebrow: product.category?.name || "Sản phẩm số",
    title: product.name,
    description,
    content: `${navigation()}
      <article style="display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:32px;margin-top:28px">
        ${image ? `<img src="${escapeHtml(image)}" alt="${escapeHtml(product.name)}" width="640" height="480" style="width:100%;max-height:480px;object-fit:contain;border-radius:24px;background:#0f172a" />` : ""}
        <div><p style="color:#94a3b8">Giá bán</p><p style="font-size:32px;font-weight:800">${formatVnd(product.price)}</p><p style="color:#cbd5e1;line-height:1.8">${escapeHtml(description)}</p><a href="/san-pham" style="color:#67e8f9">Xem và mua trên VD AI Shop</a></div>
      </article>`
  });
}

function itemListStructuredData(name, items) {
  return {
    "@context": "https://schema.org",
    "@type": "ItemList",
    name,
    numberOfItems: items.length,
    itemListElement: items.map((product, index) => ({
      "@type": "ListItem",
      position: index + 1,
      url: `${SITE_ORIGIN}${productPath(product)}`,
      name: product.name
    }))
  };
}

function productStructuredData(product) {
  const stock = product.deliveryType === "SHARED_CONTENT" ? 999 : Number(product.manualStock ?? product._count?.inventoryItems ?? 0);
  return {
    "@context": "https://schema.org",
    "@type": "Product",
    name: product.name,
    description: cleanText(product.description) || `Mua ${product.name} tại VD AI Shop.`,
    image: absoluteImage(product.imageUrl) || `${SITE_ORIGIN}/social-card.png`,
    sku: product.id,
    category: product.category?.name || "Sản phẩm số",
    brand: { "@type": "Brand", name: "VD AI Shop" },
    offers: {
      "@type": "Offer",
      url: `${SITE_ORIGIN}${productPath(product)}`,
      priceCurrency: "VND",
      price: Number(product.price || 0),
      availability: stock > 0 ? "https://schema.org/InStock" : "https://schema.org/OutOfStock",
      seller: { "@type": "Organization", name: "VD AI Shop" }
    }
  };
}

function writePage(path, html) {
  const file = path === "/" ? BASE_HTML_PATH : resolve(DIST, path.slice(1), "index.html");
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, html, "utf8");
}

function writeSitemap(paths) {
  const uniquePaths = [...new Set(paths)];
  const body = uniquePaths
    .map((path, index) => `  <url>\n    <loc>${escapeXml(`${SITE_ORIGIN}${path === "/" ? "/" : path}`)}</loc>\n    <lastmod>${today}</lastmod>\n    <changefreq>${index < 3 ? "daily" : "weekly"}</changefreq>\n    <priority>${path === "/" ? "1.0" : path === "/san-pham" ? "0.9" : "0.8"}</priority>\n  </url>`)
    .join("\n");
  writeFileSync(resolve(DIST, "sitemap.xml"), `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${body}\n</urlset>\n`, "utf8");
}

function cleanText(value) {
  return String(value || "").replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
}

function productSeoDescription(product) {
  const raw = cleanText(product.description);
  const fallback = `Mua ${product.name} tại VD AI Shop. Xem giá bán, tình trạng kho và hình thức nhận hàng.`;
  return truncate(raw.length >= 40 ? raw : `${raw ? `${raw}. ` : ""}${fallback}`, 160);
}

function truncate(value, max) {
  return value.length <= max ? value : `${value.slice(0, max - 1).trim()}…`;
}

function absoluteImage(value) {
  if (!value) return null;
  try {
    return new URL(value, SITE_ORIGIN).toString();
  } catch {
    return null;
  }
}

function formatVnd(value) {
  return `${new Intl.NumberFormat("vi-VN", { maximumFractionDigits: 0 }).format(Number(value || 0))} ₫`;
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]);
}

function escapeXml(value) {
  return escapeHtml(value);
}
