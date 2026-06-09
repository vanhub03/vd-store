CREATE TYPE "CustomerRole" AS ENUM ('CUSTOMER', 'COLLABORATOR');

ALTER TABLE "TelegramUser"
ADD COLUMN "role" "CustomerRole" NOT NULL DEFAULT 'CUSTOMER';

ALTER TABLE "Product"
ADD COLUMN "collaboratorDiscountPercent" INTEGER NOT NULL DEFAULT 0;

ALTER TABLE "Voucher"
ADD COLUMN "allowCollaboratorStacking" BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE "Order"
ADD COLUMN "collaboratorDiscountPercent" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN "collaboratorDiscountAmount" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN "voucherDiscountAmount" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN "customerRoleSnapshot" "CustomerRole" NOT NULL DEFAULT 'CUSTOMER';

UPDATE "Order"
SET "voucherDiscountAmount" = "discountAmount";

CREATE INDEX "TelegramUser_role_isBlocked_idx"
ON "TelegramUser"("role", "isBlocked");

CREATE INDEX "Order_customerRoleSnapshot_createdAt_idx"
ON "Order"("customerRoleSnapshot", "createdAt");
