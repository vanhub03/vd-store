ALTER TABLE "Order" ADD COLUMN "subtotalAmount" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "Order" ADD COLUMN "discountAmount" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "Order" ADD COLUMN "voucherCode" TEXT;
ALTER TABLE "Order" ADD COLUMN "voucherId" TEXT;
ALTER TABLE "Order" ADD COLUMN "checkoutGroupId" TEXT;

UPDATE "Order"
SET "subtotalAmount" = "totalAmount"
WHERE "subtotalAmount" = 0;

CREATE TABLE "Voucher" (
  "id" TEXT NOT NULL,
  "code" TEXT NOT NULL,
  "discountPercent" INTEGER NOT NULL,
  "maxDiscountAmount" INTEGER,
  "maxDiscountUsdt" DECIMAL(18,8),
  "active" BOOLEAN NOT NULL DEFAULT true,
  "firstOrderOnly" BOOLEAN NOT NULL DEFAULT false,
  "maxUses" INTEGER,
  "usedCount" INTEGER NOT NULL DEFAULT 0,
  "startsAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "createdByAdminId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "Voucher_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "VoucherRedemption" (
  "id" TEXT NOT NULL,
  "voucherId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "orderId" TEXT NOT NULL,
  "subtotalAmount" INTEGER NOT NULL,
  "discountAmount" INTEGER NOT NULL,
  "totalAmount" INTEGER NOT NULL,
  "claimIpHash" TEXT,
  "claimFingerprintHash" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "VoucherRedemption_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "Voucher_code_key" ON "Voucher"("code");
CREATE INDEX "Voucher_active_expiresAt_idx" ON "Voucher"("active", "expiresAt");
CREATE INDEX "Voucher_createdByAdminId_idx" ON "Voucher"("createdByAdminId");

CREATE UNIQUE INDEX "VoucherRedemption_orderId_key" ON "VoucherRedemption"("orderId");
CREATE UNIQUE INDEX "VoucherRedemption_voucherId_userId_key" ON "VoucherRedemption"("voucherId", "userId");
CREATE UNIQUE INDEX "VoucherRedemption_voucherId_claimFingerprintHash_key" ON "VoucherRedemption"("voucherId", "claimFingerprintHash");
CREATE INDEX "VoucherRedemption_userId_createdAt_idx" ON "VoucherRedemption"("userId", "createdAt");
CREATE INDEX "VoucherRedemption_voucherId_createdAt_idx" ON "VoucherRedemption"("voucherId", "createdAt");
CREATE INDEX "VoucherRedemption_voucherId_claimIpHash_idx" ON "VoucherRedemption"("voucherId", "claimIpHash");

CREATE INDEX "Order_voucherId_idx" ON "Order"("voucherId");
CREATE INDEX "Order_checkoutGroupId_idx" ON "Order"("checkoutGroupId");

ALTER TABLE "Order" ADD CONSTRAINT "Order_voucherId_fkey" FOREIGN KEY ("voucherId") REFERENCES "Voucher"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Voucher" ADD CONSTRAINT "Voucher_createdByAdminId_fkey" FOREIGN KEY ("createdByAdminId") REFERENCES "Admin"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "VoucherRedemption" ADD CONSTRAINT "VoucherRedemption_voucherId_fkey" FOREIGN KEY ("voucherId") REFERENCES "Voucher"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "VoucherRedemption" ADD CONSTRAINT "VoucherRedemption_userId_fkey" FOREIGN KEY ("userId") REFERENCES "TelegramUser"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "VoucherRedemption" ADD CONSTRAINT "VoucherRedemption_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE;
