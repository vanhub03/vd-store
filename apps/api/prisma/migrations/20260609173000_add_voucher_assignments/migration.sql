CREATE TABLE "VoucherAssignment" (
    "id" TEXT NOT NULL,
    "voucherId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "assignedByAdminId" TEXT,
    "revokedAt" TIMESTAMP(3),
    "usedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "VoucherAssignment_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "VoucherAssignment_voucherId_userId_key" ON "VoucherAssignment"("voucherId", "userId");
CREATE INDEX "VoucherAssignment_userId_createdAt_idx" ON "VoucherAssignment"("userId", "createdAt");
CREATE INDEX "VoucherAssignment_voucherId_createdAt_idx" ON "VoucherAssignment"("voucherId", "createdAt");
CREATE INDEX "VoucherAssignment_voucherId_revokedAt_usedAt_idx" ON "VoucherAssignment"("voucherId", "revokedAt", "usedAt");

ALTER TABLE "VoucherAssignment" ADD CONSTRAINT "VoucherAssignment_voucherId_fkey" FOREIGN KEY ("voucherId") REFERENCES "Voucher"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "VoucherAssignment" ADD CONSTRAINT "VoucherAssignment_userId_fkey" FOREIGN KEY ("userId") REFERENCES "TelegramUser"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "VoucherAssignment" ADD CONSTRAINT "VoucherAssignment_assignedByAdminId_fkey" FOREIGN KEY ("assignedByAdminId") REFERENCES "Admin"("id") ON DELETE SET NULL ON UPDATE CASCADE;
