CREATE TYPE "ManualOrderStatus" AS ENUM ('PENDING', 'COMPLETED', 'CANCELLED');

ALTER TABLE "Order" ADD COLUMN "manualStatus" "ManualOrderStatus" NOT NULL DEFAULT 'PENDING';

CREATE INDEX "Order_manualStatus_createdAt_idx" ON "Order"("manualStatus", "createdAt");
