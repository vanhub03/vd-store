ALTER TYPE "OrderStatus" ADD VALUE IF NOT EXISTS 'PENDING_FULFILLMENT';

CREATE TYPE "PartnerEnvironment" AS ENUM ('LIVE', 'TEST');
CREATE TYPE "PartnerOrderStatus" AS ENUM ('PENDING_FULFILLMENT', 'PARTIALLY_FULFILLED', 'FULFILLED', 'PARTIALLY_CANCELLED', 'CANCELLED');
CREATE TYPE "PartnerOrderItemStatus" AS ENUM ('PENDING_FULFILLMENT', 'FULFILLED', 'CANCELLED');
CREATE TYPE "ApiIdempotencyStatus" AS ENUM ('PENDING', 'COMPLETED');
CREATE TYPE "PartnerWebhookDeliveryStatus" AS ENUM ('PENDING', 'DELIVERED', 'FAILED');

ALTER TABLE "TelegramUser"
  ADD COLUMN "partnerApiEnabled" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "partnerReadRateLimit" INTEGER NOT NULL DEFAULT 120,
  ADD COLUMN "partnerWriteRateLimit" INTEGER NOT NULL DEFAULT 20;

ALTER TABLE "Payment" ADD COLUMN "quotedExchangeRate" DECIMAL(18,4);

CREATE TABLE "PartnerApiCredential" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "createdByAdminId" TEXT,
  "environment" "PartnerEnvironment" NOT NULL,
  "label" TEXT NOT NULL,
  "keyPrefix" TEXT NOT NULL,
  "keyHash" TEXT NOT NULL,
  "scopes" TEXT[] NOT NULL,
  "expiresAt" TIMESTAMP(3),
  "revokedAt" TIMESTAMP(3),
  "lastUsedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "PartnerApiCredential_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "PartnerOrder" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "environment" "PartnerEnvironment" NOT NULL,
  "externalOrderId" TEXT NOT NULL,
  "status" "PartnerOrderStatus" NOT NULL,
  "currency" TEXT NOT NULL DEFAULT 'VND',
  "subtotalAmount" INTEGER NOT NULL,
  "collaboratorDiscountAmount" INTEGER NOT NULL DEFAULT 0,
  "voucherDiscountAmount" INTEGER NOT NULL DEFAULT 0,
  "totalAmount" INTEGER NOT NULL,
  "refundedAmount" INTEGER NOT NULL DEFAULT 0,
  "voucherCode" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "PartnerOrder_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "PartnerOrderItem" (
  "id" TEXT NOT NULL,
  "partnerOrderId" TEXT NOT NULL,
  "productId" TEXT NOT NULL,
  "sourceOrderId" TEXT,
  "productName" TEXT NOT NULL,
  "deliveryType" "ProductDeliveryType" NOT NULL,
  "quantity" INTEGER NOT NULL,
  "unitPrice" INTEGER NOT NULL,
  "subtotalAmount" INTEGER NOT NULL,
  "collaboratorDiscountAmount" INTEGER NOT NULL DEFAULT 0,
  "voucherDiscountAmount" INTEGER NOT NULL DEFAULT 0,
  "totalAmount" INTEGER NOT NULL,
  "status" "PartnerOrderItemStatus" NOT NULL,
  "deliveryText" TEXT,
  "refundedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "PartnerOrderItem_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ApiIdempotencyRecord" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "environment" "PartnerEnvironment" NOT NULL,
  "idempotencyKey" TEXT NOT NULL,
  "requestHash" TEXT NOT NULL,
  "status" "ApiIdempotencyStatus" NOT NULL DEFAULT 'PENDING',
  "responseStatus" INTEGER,
  "responseBody" JSONB,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ApiIdempotencyRecord_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "PartnerWebhookEndpoint" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "environment" "PartnerEnvironment" NOT NULL,
  "url" TEXT NOT NULL,
  "secretCiphertext" TEXT NOT NULL,
  "secretIv" TEXT NOT NULL,
  "secretTag" TEXT NOT NULL,
  "enabled" BOOLEAN NOT NULL DEFAULT true,
  "events" TEXT[] NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "PartnerWebhookEndpoint_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "PartnerWebhookEvent" (
  "id" TEXT NOT NULL,
  "endpointId" TEXT NOT NULL,
  "partnerOrderId" TEXT,
  "type" TEXT NOT NULL,
  "payload" JSONB NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PartnerWebhookEvent_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "PartnerWebhookDelivery" (
  "id" TEXT NOT NULL,
  "eventId" TEXT NOT NULL,
  "status" "PartnerWebhookDeliveryStatus" NOT NULL DEFAULT 'PENDING',
  "attemptCount" INTEGER NOT NULL DEFAULT 0,
  "nextAttemptAt" TIMESTAMP(3),
  "responseStatus" INTEGER,
  "lastError" TEXT,
  "deliveredAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "PartnerWebhookDelivery_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "StoreSetting" (
  "key" TEXT NOT NULL,
  "value" TEXT NOT NULL,
  "updatedByAdminId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "StoreSetting_pkey" PRIMARY KEY ("key")
);

CREATE UNIQUE INDEX "PartnerApiCredential_keyHash_key" ON "PartnerApiCredential"("keyHash");
CREATE INDEX "PartnerApiCredential_userId_environment_revokedAt_idx" ON "PartnerApiCredential"("userId", "environment", "revokedAt");
CREATE INDEX "PartnerApiCredential_expiresAt_idx" ON "PartnerApiCredential"("expiresAt");
CREATE UNIQUE INDEX "PartnerOrder_userId_environment_externalOrderId_key" ON "PartnerOrder"("userId", "environment", "externalOrderId");
CREATE INDEX "PartnerOrder_userId_environment_createdAt_idx" ON "PartnerOrder"("userId", "environment", "createdAt");
CREATE INDEX "PartnerOrder_status_createdAt_idx" ON "PartnerOrder"("status", "createdAt");
CREATE UNIQUE INDEX "PartnerOrderItem_sourceOrderId_key" ON "PartnerOrderItem"("sourceOrderId");
CREATE INDEX "PartnerOrderItem_partnerOrderId_status_idx" ON "PartnerOrderItem"("partnerOrderId", "status");
CREATE INDEX "PartnerOrderItem_productId_idx" ON "PartnerOrderItem"("productId");
CREATE UNIQUE INDEX "ApiIdempotencyRecord_userId_environment_idempotencyKey_key" ON "ApiIdempotencyRecord"("userId", "environment", "idempotencyKey");
CREATE INDEX "ApiIdempotencyRecord_expiresAt_idx" ON "ApiIdempotencyRecord"("expiresAt");
CREATE UNIQUE INDEX "PartnerWebhookEndpoint_userId_environment_key" ON "PartnerWebhookEndpoint"("userId", "environment");
CREATE INDEX "PartnerWebhookEvent_endpointId_createdAt_idx" ON "PartnerWebhookEvent"("endpointId", "createdAt");
CREATE INDEX "PartnerWebhookEvent_partnerOrderId_idx" ON "PartnerWebhookEvent"("partnerOrderId");
CREATE UNIQUE INDEX "PartnerWebhookDelivery_eventId_key" ON "PartnerWebhookDelivery"("eventId");
CREATE INDEX "PartnerWebhookDelivery_status_nextAttemptAt_idx" ON "PartnerWebhookDelivery"("status", "nextAttemptAt");

ALTER TABLE "PartnerApiCredential" ADD CONSTRAINT "PartnerApiCredential_userId_fkey" FOREIGN KEY ("userId") REFERENCES "TelegramUser"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PartnerApiCredential" ADD CONSTRAINT "PartnerApiCredential_createdByAdminId_fkey" FOREIGN KEY ("createdByAdminId") REFERENCES "Admin"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "PartnerOrder" ADD CONSTRAINT "PartnerOrder_userId_fkey" FOREIGN KEY ("userId") REFERENCES "TelegramUser"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PartnerOrderItem" ADD CONSTRAINT "PartnerOrderItem_partnerOrderId_fkey" FOREIGN KEY ("partnerOrderId") REFERENCES "PartnerOrder"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PartnerOrderItem" ADD CONSTRAINT "PartnerOrderItem_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PartnerOrderItem" ADD CONSTRAINT "PartnerOrderItem_sourceOrderId_fkey" FOREIGN KEY ("sourceOrderId") REFERENCES "Order"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "ApiIdempotencyRecord" ADD CONSTRAINT "ApiIdempotencyRecord_userId_fkey" FOREIGN KEY ("userId") REFERENCES "TelegramUser"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PartnerWebhookEndpoint" ADD CONSTRAINT "PartnerWebhookEndpoint_userId_fkey" FOREIGN KEY ("userId") REFERENCES "TelegramUser"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PartnerWebhookEvent" ADD CONSTRAINT "PartnerWebhookEvent_endpointId_fkey" FOREIGN KEY ("endpointId") REFERENCES "PartnerWebhookEndpoint"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PartnerWebhookEvent" ADD CONSTRAINT "PartnerWebhookEvent_partnerOrderId_fkey" FOREIGN KEY ("partnerOrderId") REFERENCES "PartnerOrder"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "PartnerWebhookDelivery" ADD CONSTRAINT "PartnerWebhookDelivery_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "PartnerWebhookEvent"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "StoreSetting" ADD CONSTRAINT "StoreSetting_updatedByAdminId_fkey" FOREIGN KEY ("updatedByAdminId") REFERENCES "Admin"("id") ON DELETE SET NULL ON UPDATE CASCADE;
