CREATE TABLE "SoldProductSubscription" (
    "id" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "productName" TEXT NOT NULL,
    "customerName" TEXT NOT NULL,
    "zaloLink" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL,
    "durationMonths" INTEGER NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "accountNote" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "renewalReminderFor" TIMESTAMP(3),
    "renewalReminderClaimedAt" TIMESTAMP(3),
    "renewalReminderSentAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SoldProductSubscription_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "SoldProductSubscription_active_expiresAt_idx" ON "SoldProductSubscription"("active", "expiresAt");
CREATE INDEX "SoldProductSubscription_productId_idx" ON "SoldProductSubscription"("productId");
CREATE INDEX "SoldProductSubscription_createdAt_idx" ON "SoldProductSubscription"("createdAt");

ALTER TABLE "SoldProductSubscription"
ADD CONSTRAINT "SoldProductSubscription_productId_fkey"
FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
