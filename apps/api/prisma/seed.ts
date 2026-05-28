import { PrismaClient, ProductDeliveryType } from "@prisma/client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();

function slugify(input: string) {
  return input
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)+/g, "");
}

async function main() {
  const email = process.env.ADMIN_EMAIL ?? "admin@vd-store.local";
  const password = process.env.ADMIN_PASSWORD ?? "admin123456";
  const passwordHash = await bcrypt.hash(password, 12);

  await prisma.admin.upsert({
    where: { email },
    update: { passwordHash },
    create: {
      email,
      passwordHash,
      name: "Admin",
      role: "SUPER_ADMIN"
    }
  });

  const category = await prisma.category.upsert({
    where: { slug: "san-pham-so" },
    update: {},
    create: {
      name: "Sản phẩm số",
      slug: "san-pham-so",
      sortOrder: 1
    }
  });

  const productName = "Gói demo giao tự động";
  const product = await prisma.product.upsert({
    where: { slug: slugify(productName) },
    update: {},
    create: {
      categoryId: category.id,
      name: productName,
      slug: slugify(productName),
      description: "Sản phẩm mẫu dùng để kiểm thử luồng mua bằng ví hoặc chuyển khoản.",
      price: 10000,
      botPrice: 10000,
      webPrice: 10000,
      showInBot: true,
      showInWeb: true,
      deliveryType: ProductDeliveryType.STOCK_ITEM
    }
  });

  const existingInventory = await prisma.inventoryItem.count({
    where: { productId: product.id }
  });

  if (existingInventory === 0) {
    await prisma.inventoryItem.createMany({
      data: [
        { productId: product.id, content: "DEMO-CODE-001" },
        { productId: product.id, content: "DEMO-CODE-002" },
        { productId: product.id, content: "DEMO-CODE-003" }
      ]
    });
  }
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
