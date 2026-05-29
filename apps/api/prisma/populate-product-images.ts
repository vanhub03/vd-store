/**
 * Populate product images based on brand names.
 *
 * For each product in the database, this script detects the brand from the
 * product name and sets the imageUrl to the corresponding art file served
 * by the web app.
 *
 * Usage:
 *   npx tsx prisma/populate-product-images.ts
 *
 * The script uses the same brand detection logic as the web frontend so that
 * products always display the correct brand artwork.
 */

import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

/** Map product name → brand key, same logic as the frontend `brandTone`. */
function detectBrand(name: string): string {
  const lower = name.toLowerCase();
  if (lower.includes("chatgpt") || lower.includes("openai")) return "openai";
  if (lower.includes("claude")) return "claude";
  if (lower.includes("gemini") || lower.includes("gemeni")) return "gemini";
  if (lower.includes("canva")) return "canva";
  if (lower.includes("youtube")) return "youtube";
  if (lower.includes("adobe")) return "adobe";
  if (lower.includes("capcut")) return "capcut";
  if (lower.includes("grok")) return "grok";
  if (lower.includes("cursor")) return "cursor";
  return "default";
}

async function main() {
  const products = await prisma.product.findMany({
    select: { id: true, name: true, imageUrl: true }
  });

  console.log(`Found ${products.length} products. Populating image URLs...\n`);

  let updated = 0;

  for (const product of products) {
    const brand = detectBrand(product.name);
    const imageUrl = `/product-art/${brand}.svg`;

    // Only update if imageUrl is empty or already points to product-art
    if (!product.imageUrl || product.imageUrl.includes("/product-art/")) {
      await prisma.product.update({
        where: { id: product.id },
        data: { imageUrl }
      });
      console.log(`  ✓ ${product.name} → ${imageUrl}`);
      updated++;
    } else {
      console.log(`  ○ ${product.name} — kept existing: ${product.imageUrl}`);
    }
  }

  console.log(`\nDone. Updated ${updated}/${products.length} products.`);
}

main()
  .catch((error) => {
    console.error("Error populating product images:", error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
