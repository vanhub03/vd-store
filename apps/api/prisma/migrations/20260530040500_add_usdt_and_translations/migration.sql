ALTER TYPE "PaymentMethod" ADD VALUE IF NOT EXISTS 'BINANCE_PAY';

ALTER TABLE "Product"
ADD COLUMN "nameEn" TEXT,
ADD COLUMN "descriptionEn" TEXT,
ADD COLUMN "usdtPrice" DECIMAL(18, 8);

UPDATE "Product"
SET "nameEn" = "name",
    "descriptionEn" = "description"
WHERE "nameEn" IS NULL;

ALTER TABLE "Payment"
ADD COLUMN "provider" TEXT NOT NULL DEFAULT 'sepay',
ADD COLUMN "cryptoCurrency" TEXT,
ADD COLUMN "cryptoAmount" DECIMAL(18, 8),
ADD COLUMN "providerPaymentId" TEXT,
ADD COLUMN "checkoutUrl" TEXT,
ADD COLUMN "deeplink" TEXT,
ADD COLUMN "providerPayload" JSONB;

CREATE INDEX "Product_usdtPrice_idx" ON "Product"("usdtPrice");
CREATE INDEX "Payment_provider_idx" ON "Payment"("provider");
CREATE INDEX "Payment_providerPaymentId_idx" ON "Payment"("providerPaymentId");
