# VD Store

Telegram sales bot with a Vietnamese admin dashboard, wallet balance, VietQR/SePay bank-transfer payments, automatic fulfillment, and transaction history.

## Local Setup

1. Copy `.env.example` to `.env` and fill Telegram, SePay, and VietQR bank values.
2. Start infrastructure:

   ```bash
   docker compose up -d
   ```

3. Install dependencies and prepare Prisma:

   ```bash
   pnpm install
   pnpm prisma:generate
   pnpm prisma:migrate
   pnpm prisma:seed
   ```

4. Run services:

   ```bash
   pnpm dev:api
   pnpm dev:bot
   pnpm dev:admin
   ```

Admin UI runs on `http://localhost:5173`, API on `http://localhost:3000`.

For SePay and Telegram webhooks during local development, expose the API/bot ports through a public HTTPS tunnel such as ngrok or cloudflared.
