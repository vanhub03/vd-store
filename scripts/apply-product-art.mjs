import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PrismaClient } from "@prisma/client";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
loadEnv(path.join(root, ".env"));

const prisma = new PrismaClient();
const baseUrl = (process.env.STORE_PRODUCT_ART_BASE_URL ?? "https://vanhdao.io.vn/product-art").replace(/\/$/, "");

const brandFiles = new Set([
  "openai",
  "claude",
  "gemini",
  "canva",
  "youtube",
  "adobe",
  "capcut",
  "grok",
  "cursor",
  "default"
]);

try {
  const products = await prisma.product.findMany({
    select: { id: true, name: true, imageUrl: true, showInWeb: true }
  });
  let updated = 0;

  for (const product of products) {
    const brand = inferBrand(product.name);
    const file = brandFiles.has(brand) ? brand : "default";
    const imageUrl = `${baseUrl}/${file}.svg`;
    if (product.imageUrl === imageUrl) continue;
    await prisma.product.update({
      where: { id: product.id },
      data: { imageUrl }
    });
    updated += 1;
    console.log(`Updated ${product.name} -> ${imageUrl}`);
  }

  console.log(`Product art applied: ${updated}/${products.length} product(s) updated.`);
} finally {
  await prisma.$disconnect();
}

function inferBrand(name) {
  const lower = name.toLocaleLowerCase("vi-VN");
  if (lower.includes("chatgpt") || lower.includes("openai")) return "openai";
  if (lower.includes("claude")) return "claude";
  if (lower.includes("gemini")) return "gemini";
  if (lower.includes("canva")) return "canva";
  if (lower.includes("youtube")) return "youtube";
  if (lower.includes("adobe")) return "adobe";
  if (lower.includes("capcut")) return "capcut";
  if (lower.includes("grok")) return "grok";
  if (lower.includes("cursor")) return "cursor";
  return "default";
}

function loadEnv(filePath) {
  if (!fs.existsSync(filePath)) return;
  const content = fs.readFileSync(filePath, "utf8");
  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#") || !trimmed.includes("=")) continue;
    const index = trimmed.indexOf("=");
    const key = trimmed.slice(0, index).trim();
    let value = trimmed.slice(index + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    process.env[key] ??= value;
  }
}
