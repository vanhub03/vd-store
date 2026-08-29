ALTER TABLE "SoldProductSubscription"
  ADD COLUMN "saleAmount" INTEGER;

ALTER TABLE "SoldProductSubscription"
  DROP CONSTRAINT "SoldProductSubscription_productId_fkey";

ALTER TABLE "SoldProductSubscription"
  ALTER COLUMN "productId" DROP NOT NULL;

ALTER TABLE "SoldProductSubscription"
  ADD CONSTRAINT "SoldProductSubscription_productId_fkey"
  FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE SET NULL ON UPDATE CASCADE;
