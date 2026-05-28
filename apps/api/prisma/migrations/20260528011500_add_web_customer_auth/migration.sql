ALTER TABLE "TelegramUser"
ADD COLUMN "email" TEXT,
ADD COLUMN "passwordHash" TEXT,
ADD COLUMN "displayName" TEXT;

CREATE UNIQUE INDEX "TelegramUser_email_key" ON "TelegramUser"("email");
