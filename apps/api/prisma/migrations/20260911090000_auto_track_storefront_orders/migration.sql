CREATE TYPE "SalesChannel" AS ENUM ('BOT', 'WEB', 'PARTNER_API');

ALTER TABLE "Product"
  ADD COLUMN "subscriptionDurationMonths" INTEGER NOT NULL DEFAULT 1;

UPDATE "Product"
SET "subscriptionDurationMonths" = LEAST(120, GREATEST(1,
  CASE
    WHEN lower("name") ~ '([0-9]+)[[:space:]]*(năm|nam|years?|yrs?)' THEN
      (substring(lower("name") from '([0-9]+)[[:space:]]*(năm|nam|years?|yrs?)'))::INTEGER * 12
    WHEN lower("name") ~ '([0-9]+)[[:space:]]*(tháng|thang|months?|mos?)' THEN
      (substring(lower("name") from '([0-9]+)[[:space:]]*(tháng|thang|months?|mos?)'))::INTEGER
    ELSE 1
  END
));

ALTER TABLE "Order"
  ADD COLUMN "salesChannel" "SalesChannel" NOT NULL DEFAULT 'BOT';

UPDATE "Order" AS orders
SET "salesChannel" = 'WEB'
FROM "TelegramUser" AS users, "Product" AS products
WHERE orders."userId" = users."id"
  AND orders."productId" = products."id"
  AND (
    users."telegramId" LIKE 'web:%'
    OR (products."webPrice" <> products."botPrice" AND orders."unitPrice" = products."webPrice")
  );

UPDATE "Order" AS orders
SET "salesChannel" = 'PARTNER_API'
WHERE EXISTS (
  SELECT 1
  FROM "PartnerOrderItem" AS partner_items
  WHERE partner_items."sourceOrderId" = orders."id"
);

ALTER TABLE "SoldProductSubscription"
  ADD COLUMN "sourceOrderId" TEXT;

CREATE UNIQUE INDEX "SoldProductSubscription_sourceOrderId_key"
  ON "SoldProductSubscription"("sourceOrderId");

ALTER TABLE "SoldProductSubscription"
  ADD CONSTRAINT "SoldProductSubscription_sourceOrderId_fkey"
  FOREIGN KEY ("sourceOrderId") REFERENCES "Order"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

INSERT INTO "SoldProductSubscription" (
  "id",
  "productId",
  "productName",
  "saleAmount",
  "customerName",
  "startedAt",
  "durationMonths",
  "expiresAt",
  "accountNote",
  "active",
  "sourceOrderId",
  "createdAt",
  "updatedAt"
)
SELECT
  'auto_' || md5(orders."id"),
  products."id",
  products."name",
  orders."totalAmount",
  COALESCE(
    NULLIF(BTRIM(users."displayName"), ''),
    CASE WHEN NULLIF(BTRIM(users."username"), '') IS NOT NULL THEN '@' || BTRIM(users."username") END,
    NULLIF(BTRIM(CONCAT_WS(' ', users."firstName", users."lastName")), ''),
    NULLIF(BTRIM(users."email"), ''),
    users."telegramId"
  ),
  ((COALESCE(orders."fulfilledAt", orders."updatedAt", orders."createdAt") AT TIME ZONE 'Asia/Ho_Chi_Minh')::date)::timestamp,
  products."subscriptionDurationMonths",
  ((COALESCE(orders."fulfilledAt", orders."updatedAt", orders."createdAt") AT TIME ZONE 'Asia/Ho_Chi_Minh')::date)::timestamp
    + make_interval(months => products."subscriptionDurationMonths"),
  NULLIF(BTRIM(orders."deliveryText"), ''),
  (
    ((COALESCE(orders."fulfilledAt", orders."updatedAt", orders."createdAt") AT TIME ZONE 'Asia/Ho_Chi_Minh')::date)::timestamp
      + make_interval(months => products."subscriptionDurationMonths")
  ) >= ((CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Ho_Chi_Minh')::date)::timestamp,
  orders."id",
  COALESCE(orders."fulfilledAt", orders."updatedAt", orders."createdAt"),
  CURRENT_TIMESTAMP
FROM "Order" AS orders
JOIN "Product" AS products ON products."id" = orders."productId"
JOIN "TelegramUser" AS users ON users."id" = orders."userId"
WHERE orders."salesChannel" IN ('BOT', 'WEB')
  AND orders."status" IN ('PAID', 'FULFILLED', 'PENDING_FULFILLMENT')
  AND orders."manualStatus" <> 'CANCELLED'
  AND NOT EXISTS (
    SELECT 1
    FROM "SoldProductSubscription" AS subscriptions
    WHERE subscriptions."sourceOrderId" = orders."id"
  );
