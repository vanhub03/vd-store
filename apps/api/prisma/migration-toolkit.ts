import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import { Prisma, PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const orderedModels = [
  "Admin",
  "TelegramUser",
  "Category",
  "Product",
  "InventoryItem",
  "Voucher",
  "VoucherAssignment",
  "Order",
  "Payment",
  "BankTransaction",
  "WalletLedgerEntry",
  "VoucherRedemption",
  "ProductReview",
  "Broadcast",
  "BroadcastDelivery",
  "PartnerApiCredential",
  "PartnerOrder",
  "PartnerOrderItem",
  "ApiIdempotencyRecord",
  "PartnerWebhookEndpoint",
  "PartnerWebhookEvent",
  "PartnerWebhookDelivery",
  "StoreSetting",
  "AuditLog"
] as const;

const fieldMap: Record<string, string[]> = {
  Admin: ["id", "email", "passwordHash", "name", "role", "createdAt", "updatedAt"],
  TelegramUser: ["id", "telegramId", "email", "passwordHash", "displayName", "username", "firstName", "lastName", "languageCode", "role", "isBlocked", "partnerApiEnabled", "partnerReadRateLimit", "partnerWriteRateLimit", "createdAt", "updatedAt"],
  Category: ["id", "name", "slug", "sortOrder", "active", "createdAt", "updatedAt"],
  Product: ["id", "categoryId", "name", "nameEn", "slug", "description", "descriptionEn", "imageUrl", "buttonIcon", "price", "botPrice", "webPrice", "usdtPrice", "collaboratorDiscountPercent", "showInBot", "showInWeb", "status", "deliveryType", "sharedContent", "sharedFilePath", "manualInstructions", "manualStock", "createdAt", "updatedAt"],
  InventoryItem: ["id", "productId", "content", "status", "orderId", "soldAt", "createdAt"],
  Order: ["id", "code", "checkoutGroupId", "userId", "productId", "quantity", "unitPrice", "subtotalAmount", "discountAmount", "collaboratorDiscountPercent", "collaboratorDiscountAmount", "voucherDiscountAmount", "customerRoleSnapshot", "totalAmount", "status", "manualStatus", "paymentMethod", "voucherCode", "voucherId", "deliveryText", "expiresAt", "fulfilledAt", "createdAt", "updatedAt"],
  Voucher: ["id", "code", "discountPercent", "maxDiscountAmount", "maxDiscountUsdt", "active", "firstOrderOnly", "allowCollaboratorStacking", "maxUses", "usedCount", "startsAt", "expiresAt", "createdByAdminId", "createdAt", "updatedAt"],
  VoucherAssignment: ["id", "voucherId", "userId", "assignedByAdminId", "revokedAt", "usedAt", "createdAt"],
  VoucherRedemption: ["id", "voucherId", "userId", "orderId", "subtotalAmount", "discountAmount", "totalAmount", "claimIpHash", "claimFingerprintHash", "createdAt"],
  Payment: ["id", "code", "kind", "status", "amount", "expectedAmount", "userId", "orderId", "expiresAt", "qrImageUrl", "qrPayload", "provider", "cryptoCurrency", "cryptoAmount", "quotedExchangeRate", "providerPaymentId", "checkoutUrl", "deeplink", "providerPayload", "telegramChatId", "telegramMessageId", "createdAt", "updatedAt"],
  WalletLedgerEntry: ["id", "userId", "amount", "type", "referencePaymentId", "referenceOrderId", "note", "createdAt"],
  BankTransaction: ["id", "provider", "providerTransactionId", "gateway", "transactionDate", "accountNumber", "subAccount", "code", "content", "transferType", "transferAmount", "accumulated", "referenceCode", "rawPayload", "paymentId", "createdAt"],
  ProductReview: ["id", "userId", "productId", "rating", "title", "content", "createdAt", "updatedAt"],
  Broadcast: ["id", "title", "message", "status", "target", "sentCount", "failedCount", "createdByAdminId", "createdAt", "updatedAt"],
  BroadcastDelivery: ["id", "broadcastId", "userId", "status", "error", "sentAt", "createdAt"],
  PartnerApiCredential: ["id", "userId", "createdByAdminId", "environment", "label", "keyPrefix", "keyHash", "scopes", "expiresAt", "revokedAt", "lastUsedAt", "createdAt", "updatedAt"],
  PartnerOrder: ["id", "userId", "environment", "externalOrderId", "status", "currency", "subtotalAmount", "collaboratorDiscountAmount", "voucherDiscountAmount", "totalAmount", "refundedAmount", "voucherCode", "createdAt", "updatedAt"],
  PartnerOrderItem: ["id", "partnerOrderId", "productId", "sourceOrderId", "productName", "deliveryType", "quantity", "unitPrice", "subtotalAmount", "collaboratorDiscountAmount", "voucherDiscountAmount", "totalAmount", "status", "deliveryText", "refundedAt", "createdAt", "updatedAt"],
  ApiIdempotencyRecord: ["id", "userId", "environment", "idempotencyKey", "requestHash", "status", "responseStatus", "responseBody", "expiresAt", "createdAt", "updatedAt"],
  PartnerWebhookEndpoint: ["id", "userId", "environment", "url", "secretCiphertext", "secretIv", "secretTag", "enabled", "events", "createdAt", "updatedAt"],
  PartnerWebhookEvent: ["id", "endpointId", "partnerOrderId", "type", "payload", "createdAt"],
  PartnerWebhookDelivery: ["id", "eventId", "status", "attemptCount", "nextAttemptAt", "responseStatus", "lastError", "deliveredAt", "createdAt", "updatedAt"],
  StoreSetting: ["key", "value", "updatedByAdminId", "createdAt", "updatedAt"],
  AuditLog: ["id", "actorAdminId", "action", "entityType", "entityId", "meta", "createdAt"]
};

const dateFields = new Set([
  "createdAt",
  "updatedAt",
  "soldAt",
  "expiresAt",
  "fulfilledAt",
  "startsAt",
  "revokedAt",
  "usedAt",
  "transactionDate",
  "sentAt",
  "lastUsedAt",
  "refundedAt",
  "nextAttemptAt",
  "deliveredAt"
]);

async function main() {
  const command = process.argv[2] ?? "help";
  const target = process.argv[3];

  if (command === "discover") {
    console.log(JSON.stringify(await discover(), null, 2));
    return;
  }

  if (command === "snapshot") {
    const snapshot = await createSnapshot();
    await writeOrPrint(snapshot, target);
    return;
  }

  if (command === "reconcile") {
    const baseline = target ? JSON.parse(await fs.readFile(path.resolve(target), "utf8")) : null;
    const result = await reconcile(baseline);
    await writeOrPrint(result, process.argv[4]);
    if (result.issues.length) process.exitCode = 1;
    return;
  }

  if (command === "import-json") {
    if (!target) throw new Error("Usage: pnpm --filter @vd-store/api migration:import <path-to-export.json>");
    console.log(JSON.stringify(await importJson(path.resolve(target)), null, 2));
    return;
  }

  console.log(`Usage:
  tsx prisma/migration-toolkit.ts discover
  tsx prisma/migration-toolkit.ts snapshot [snapshot.json]
  tsx prisma/migration-toolkit.ts reconcile [baseline-snapshot.json] [result.json]
  tsx prisma/migration-toolkit.ts import-json export.json

JSON import accepts arrays keyed by model name, for example:
  { "TelegramUser": [...], "Product": [...], "Order": [...] }
or plural/lowercase keys such as users, products, orders.`);
}

async function discover() {
  const [database] = await prisma.$queryRaw<Array<{ database: string; user: string; version: string }>>`
    SELECT current_database() AS database, current_user AS user, version() AS version
  `;
  const migrationCount = await prisma.$queryRaw<Array<{ count: bigint }>>`
    SELECT count(*) AS count FROM "_prisma_migrations"
  `.catch(() => [{ count: 0n }]);
  return {
    database,
    migrationCount: Number(migrationCount[0]?.count ?? 0),
    tables: await tableCounts()
  };
}

async function createSnapshot() {
  const [
    counts,
    wallet,
    revenue,
    availableInventory,
    manualStock,
    voucherUsedCount,
    voucherRedemptions,
    ordersByStatus,
    paymentsByStatus
  ] = await Promise.all([
    tableCounts(),
    prisma.walletLedgerEntry.aggregate({ _sum: { amount: true } }),
    prisma.payment.aggregate({
      where: { status: "SUCCEEDED", kind: { in: ["DIRECT_ORDER", "WALLET_PURCHASE"] } },
      _sum: { amount: true }
    }),
    prisma.inventoryItem.count({ where: { status: "AVAILABLE" } }),
    prisma.product.aggregate({ _sum: { manualStock: true } }),
    prisma.voucher.aggregate({ _sum: { usedCount: true } }),
    prisma.voucherRedemption.count(),
    prisma.order.groupBy({ by: ["status"], _count: { id: true } }),
    prisma.payment.groupBy({ by: ["status"], _count: { id: true } })
  ]);

  const snapshot = {
    generatedAt: new Date().toISOString(),
    counts,
    totals: {
      walletBalance: wallet._sum.amount ?? 0,
      revenue: revenue._sum.amount ?? 0,
      availableInventory,
      manualStock: manualStock._sum.manualStock ?? 0,
      voucherUsedCount: voucherUsedCount._sum.usedCount ?? 0,
      voucherRedemptions
    },
    ordersByStatus: Object.fromEntries(ordersByStatus.map((item) => [item.status, item._count.id])),
    paymentsByStatus: Object.fromEntries(paymentsByStatus.map((item) => [item.status, item._count.id]))
  };

  return {
    ...snapshot,
    checksum: checksum(snapshot)
  };
}

async function tableCounts() {
  const entries = await Promise.all(
    orderedModels.map(async (model) => [model, await modelClient(model).count()] as const)
  );
  return Object.fromEntries(entries);
}

async function reconcile(baseline: any) {
  const current = await createSnapshot();
  const issues: string[] = [];

  if (baseline) {
    for (const [table, expected] of Object.entries(baseline.counts ?? {})) {
      const actual = current.counts[table as keyof typeof current.counts];
      if (actual !== expected) issues.push(`Count mismatch for ${table}: expected ${expected}, got ${actual}`);
    }
    for (const [key, expected] of Object.entries(baseline.totals ?? {})) {
      const actual = current.totals[key as keyof typeof current.totals];
      if (actual !== expected) issues.push(`Total mismatch for ${key}: expected ${expected}, got ${actual}`);
    }
  }

  const orphanChecks = await Promise.all([
    orphanCount(`SELECT count(*)::int AS count FROM "Order" o LEFT JOIN "TelegramUser" u ON u.id = o."userId" WHERE u.id IS NULL`, "Order.userId"),
    orphanCount(`SELECT count(*)::int AS count FROM "Order" o LEFT JOIN "Product" p ON p.id = o."productId" WHERE p.id IS NULL`, "Order.productId"),
    orphanCount(`SELECT count(*)::int AS count FROM "Payment" p LEFT JOIN "TelegramUser" u ON u.id = p."userId" WHERE p."userId" IS NOT NULL AND u.id IS NULL`, "Payment.userId"),
    orphanCount(`SELECT count(*)::int AS count FROM "Payment" p LEFT JOIN "Order" o ON o.id = p."orderId" WHERE p."orderId" IS NOT NULL AND o.id IS NULL`, "Payment.orderId"),
    orphanCount(`SELECT count(*)::int AS count FROM "InventoryItem" i LEFT JOIN "Product" p ON p.id = i."productId" WHERE p.id IS NULL`, "InventoryItem.productId"),
    orphanCount(`SELECT count(*)::int AS count FROM "VoucherAssignment" a LEFT JOIN "Voucher" v ON v.id = a."voucherId" WHERE v.id IS NULL`, "VoucherAssignment.voucherId"),
    orphanCount(`SELECT count(*)::int AS count FROM "VoucherRedemption" r LEFT JOIN "Order" o ON o.id = r."orderId" WHERE o.id IS NULL`, "VoucherRedemption.orderId")
  ]);
  for (const check of orphanChecks) {
    if (check.count > 0) issues.push(`Orphan records for ${check.name}: ${check.count}`);
  }

  const mismatchedVouchers = await prisma.voucher.findMany({
    select: { id: true, code: true, usedCount: true, _count: { select: { redemptions: true } } }
  });
  for (const voucher of mismatchedVouchers) {
    if (voucher.usedCount !== voucher._count.redemptions) {
      issues.push(`Voucher ${voucher.code} usedCount=${voucher.usedCount}, redemptions=${voucher._count.redemptions}`);
    }
  }

  return { ok: issues.length === 0, issues, current };
}

async function orphanCount(sql: string, name: string) {
  const rows = await prisma.$queryRawUnsafe<Array<{ count: number | bigint }>>(sql);
  return { name, count: Number(rows[0]?.count ?? 0) };
}

async function importJson(filePath: string) {
  const raw = JSON.parse(await fs.readFile(filePath, "utf8"));
  const imported: Record<string, number> = {};

  for (const model of orderedModels) {
    const rows = rowsForModel(raw, model);
    if (!rows.length) {
      imported[model] = 0;
      continue;
    }
    for (const row of rows) {
      const create = sanitize(model, row);
      const where = uniqueWhere(model, create);
      const update = { ...create };
      delete update.id;
      await modelClient(model).upsert({ where, create, update });
    }
    imported[model] = rows.length;
  }

  return {
    imported,
    snapshot: await createSnapshot()
  };
}

function rowsForModel(raw: Record<string, unknown>, model: string) {
  const aliases = [
    model,
    model[0].toLowerCase() + model.slice(1),
    `${model[0].toLowerCase()}${model.slice(1)}s`,
    model.toLowerCase(),
    `${model.toLowerCase()}s`
  ];
  for (const key of aliases) {
    const value = raw[key];
    if (Array.isArray(value)) return value as Record<string, unknown>[];
  }
  return [];
}

function sanitize(model: string, row: Record<string, unknown>) {
  const fields = fieldMap[model];
  const data: Record<string, unknown> = {};
  for (const field of fields) {
    if (!(field in row)) continue;
    const value = row[field];
    if (value === undefined) continue;
    data[field] = dateFields.has(field) && value !== null ? new Date(String(value)) : value;
  }
  applyDefaults(model, data);
  return data;
}

function applyDefaults(model: string, data: Record<string, unknown>) {
  if (model === "TelegramUser") {
    data.role ??= "CUSTOMER";
    data.isBlocked ??= false;
  }
  if (model === "Order") {
    data.collaboratorDiscountPercent ??= 0;
    data.collaboratorDiscountAmount ??= 0;
    data.voucherDiscountAmount ??= Number(data.discountAmount ?? 0);
    data.customerRoleSnapshot ??= "CUSTOMER";
    data.manualStatus ??= "PENDING";
  }
  if (model === "Payment") {
    data.provider ??= "sepay";
  }
  if (model === "Voucher") {
    data.active ??= true;
    data.firstOrderOnly ??= false;
    data.allowCollaboratorStacking ??= false;
    data.usedCount ??= 0;
  }
}

function uniqueWhere(model: string, data: Record<string, unknown>) {
  if (data.id) return { id: data.id };
  if (model === "Admin" && data.email) return { email: data.email };
  if (model === "TelegramUser" && data.telegramId) return { telegramId: data.telegramId };
  if (model === "TelegramUser" && data.email) return { email: data.email };
  if (model === "Category" && data.slug) return { slug: data.slug };
  if (model === "Product" && data.slug) return { slug: data.slug };
  if (model === "Order" && data.code) return { code: data.code };
  if (model === "Voucher" && data.code) return { code: data.code };
  if (model === "Payment" && data.code) return { code: data.code };
  if (model === "BankTransaction" && data.providerTransactionId) return { providerTransactionId: data.providerTransactionId };
  if (model === "VoucherAssignment" && data.voucherId && data.userId) {
    return { voucherId_userId: { voucherId: data.voucherId, userId: data.userId } };
  }
  if (model === "VoucherRedemption" && data.orderId) return { orderId: data.orderId };
  throw new Error(`Cannot build unique key for ${model}. Provide id or a known unique field.`);
}

function modelClient(model: string) {
  return (prisma as unknown as Record<string, any>)[model[0].toLowerCase() + model.slice(1)];
}

function checksum(value: unknown) {
  return crypto.createHash("sha256").update(stableStringify(value)).digest("hex");
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, item]) => `${JSON.stringify(key)}:${stableStringify(item)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

async function writeOrPrint(value: unknown, filePath?: string) {
  const text = `${JSON.stringify(value, (_, item) => (typeof item === "bigint" ? Number(item) : item), 2)}\n`;
  if (filePath) {
    await fs.writeFile(path.resolve(filePath), text, "utf8");
  } else {
    console.log(text);
  }
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
