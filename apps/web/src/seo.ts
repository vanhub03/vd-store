import type { Catalog, Product } from "./api";

export const SITE_ORIGIN = "https://www.vanhdao.io.vn";

export type PublicStoreRoute =
  | { kind: "home"; path: "/" }
  | { kind: "products"; path: "/san-pham" }
  | { kind: "reviews"; path: "/danh-gia" }
  | { kind: "category"; path: string; slug: string }
  | { kind: "product"; path: string; slug: string }
  | { kind: "private"; tab: "history" | "vouchers"; path: string };

export function seoSlug(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/đ/gi, "d")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80) || "san-pham";
}

function entitySuffix(id: string) {
  return id.toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 8) || "item";
}

export function productPath(product: Pick<Product, "id" | "name">) {
  return `/san-pham/${seoSlug(product.name)}-${entitySuffix(product.id)}`;
}

export function categoryPath(category: { id: string; name: string }) {
  return `/danh-muc/${seoSlug(category.name)}-${entitySuffix(category.id)}`;
}

export function publicTabPath(tab: "home" | "products" | "reviews") {
  if (tab === "products") return "/san-pham";
  if (tab === "reviews") return "/danh-gia";
  return "/";
}

export function readStoreRoute(pathname: string, search = ""): PublicStoreRoute {
  const normalizedPath = normalizePath(pathname);
  if (normalizedPath === "/san-pham") return { kind: "products", path: normalizedPath };
  if (normalizedPath === "/danh-gia") return { kind: "reviews", path: normalizedPath };
  if (normalizedPath.startsWith("/danh-muc/")) {
    return { kind: "category", path: normalizedPath, slug: normalizedPath.slice("/danh-muc/".length) };
  }
  if (normalizedPath.startsWith("/san-pham/")) {
    return { kind: "product", path: normalizedPath, slug: normalizedPath.slice("/san-pham/".length) };
  }

  const params = new URLSearchParams(search);
  const tab = params.get("tab");
  if (params.get("category") || tab === "products") return { kind: "products", path: "/san-pham" };
  if (tab === "reviews") return { kind: "reviews", path: "/danh-gia" };
  if (tab === "history" || tab === "vouchers") return { kind: "private", tab, path: `${normalizedPath}${search}` };
  return { kind: "home", path: "/" };
}

export function findRouteCategory(catalog: Catalog | null, pathname: string) {
  if (!catalog) return null;
  return catalog.categories.find((category) => categoryPath(category) === normalizePath(pathname)) ?? null;
}

export function findRouteProduct(products: Product[], pathname: string) {
  const normalizedPath = normalizePath(pathname);
  return products.find((product) => productPath(product) === normalizedPath) ?? null;
}

export function absoluteStoreUrl(path: string) {
  return `${SITE_ORIGIN}${normalizePath(path) === "/" ? "/" : normalizePath(path)}`;
}

export function normalizePath(pathname: string) {
  const withLeadingSlash = pathname.startsWith("/") ? pathname : `/${pathname}`;
  const normalized = withLeadingSlash.replace(/\/{2,}/g, "/").replace(/\/+$/, "");
  return normalized || "/";
}
