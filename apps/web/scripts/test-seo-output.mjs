import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const SITE_ORIGIN = "https://www.vanhdao.io.vn";
const DIST = resolve(process.cwd(), "dist");
const sitemapPath = resolve(DIST, "sitemap.xml");

assert(existsSync(sitemapPath), "dist/sitemap.xml is missing");
const sitemap = readFileSync(sitemapPath, "utf8");
const urls = [...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)].map((match) => match[1]);

assert(urls.length >= 4, "sitemap must contain public routes");
assert(new Set(urls).size === urls.length, "sitemap contains duplicate URLs");
assert(urls.includes(`${SITE_ORIGIN}/`), "sitemap is missing the home page");
assert(urls.includes(`${SITE_ORIGIN}/san-pham`), "sitemap is missing /san-pham");
assert(urls.includes(`${SITE_ORIGIN}/danh-gia`), "sitemap is missing /danh-gia");
assert(urls.some((url) => url.startsWith(`${SITE_ORIGIN}/danh-muc/`)), "sitemap is missing category pages");
assert(urls.some((url) => url.startsWith(`${SITE_ORIGIN}/san-pham/`)), "sitemap is missing product pages");
assert(!urls.some((url) => url.includes("?tab=") || url.includes("?category=")), "legacy query URLs must not be in sitemap");

for (const url of urls) {
  assert(url.startsWith(SITE_ORIGIN), `unexpected sitemap origin: ${url}`);
  const pathname = new URL(url).pathname;
  const file = pathname === "/" ? resolve(DIST, "index.html") : resolve(DIST, pathname.slice(1), "index.html");
  assert(existsSync(file), `prerendered file is missing for ${url}`);
  const html = readFileSync(file, "utf8");
  assert(html.includes(`<link rel="canonical" href="${url}" />`), `canonical mismatch for ${url}`);
  assert(/<title>[^<]{8,}<\/title>/i.test(html), `title is missing for ${url}`);
  assert(/<meta name="description" content="[^"]{20,}" \/>/i.test(html), `description is missing for ${url}`);
  assert(html.includes('name="robots" content="index, follow, max-image-preview:large"'), `robots directive mismatch for ${url}`);
  assert(count(html, 'id="vd-page-structured-data"') === 1, `structured data must appear once for ${url}`);
  assert(count(html, "<h1") === 1, `page must contain exactly one prerendered h1 for ${url}`);
}

console.log(`SEO output contract passed for ${urls.length} URLs.`);

function count(value, token) {
  return value.split(token).length - 1;
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}
