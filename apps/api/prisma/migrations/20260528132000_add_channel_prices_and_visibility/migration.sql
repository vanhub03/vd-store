ALTER TABLE "Product" ADD COLUMN "botPrice" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "Product" ADD COLUMN "webPrice" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "Product" ADD COLUMN "showInBot" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "Product" ADD COLUMN "showInWeb" BOOLEAN NOT NULL DEFAULT true;

UPDATE "Product"
SET "botPrice" = "price",
    "webPrice" = "price"
WHERE "botPrice" = 0 OR "webPrice" = 0;

CREATE INDEX "Product_showInBot_idx" ON "Product"("showInBot");
CREATE INDEX "Product_showInWeb_idx" ON "Product"("showInWeb");
