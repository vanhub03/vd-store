-- Hot-path indexes for PostgreSQL migration and production read/write workloads.
-- These indexes are intentionally additive and safe for existing data.

CREATE INDEX IF NOT EXISTS "TelegramUser_isBlocked_createdAt_idx" ON "TelegramUser"("isBlocked", "createdAt");
CREATE INDEX IF NOT EXISTS "TelegramUser_createdAt_idx" ON "TelegramUser"("createdAt");

CREATE INDEX IF NOT EXISTS "Category_active_sortOrder_name_idx" ON "Category"("active", "sortOrder", "name");

CREATE INDEX IF NOT EXISTS "Product_status_showInWeb_categoryId_createdAt_idx" ON "Product"("status", "showInWeb", "categoryId", "createdAt");
CREATE INDEX IF NOT EXISTS "Product_status_showInBot_categoryId_createdAt_idx" ON "Product"("status", "showInBot", "categoryId", "createdAt");
CREATE INDEX IF NOT EXISTS "Product_createdAt_idx" ON "Product"("createdAt");

CREATE INDEX IF NOT EXISTS "Order_status_createdAt_idx" ON "Order"("status", "createdAt");
CREATE INDEX IF NOT EXISTS "Order_paymentMethod_createdAt_idx" ON "Order"("paymentMethod", "createdAt");

CREATE INDEX IF NOT EXISTS "VoucherAssignment_userId_revokedAt_usedAt_createdAt_idx" ON "VoucherAssignment"("userId", "revokedAt", "usedAt", "createdAt");

CREATE INDEX IF NOT EXISTS "Payment_provider_providerPaymentId_idx" ON "Payment"("provider", "providerPaymentId");
CREATE INDEX IF NOT EXISTS "Payment_provider_status_idx" ON "Payment"("provider", "status");
CREATE INDEX IF NOT EXISTS "Payment_createdAt_idx" ON "Payment"("createdAt");

CREATE INDEX IF NOT EXISTS "WalletLedgerEntry_createdAt_idx" ON "WalletLedgerEntry"("createdAt");
CREATE INDEX IF NOT EXISTS "BankTransaction_provider_transactionDate_idx" ON "BankTransaction"("provider", "transactionDate");
CREATE INDEX IF NOT EXISTS "Broadcast_status_createdAt_idx" ON "Broadcast"("status", "createdAt");
CREATE INDEX IF NOT EXISTS "AuditLog_createdAt_idx" ON "AuditLog"("createdAt");
