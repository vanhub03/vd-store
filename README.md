# VD Store

Telegram sales bot with a Vietnamese admin dashboard, public storefront website, wallet balance, VietQR/SePay bank-transfer payments, automatic fulfillment, and transaction history.

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
   pnpm dev:web
   ```

Admin UI runs on `http://localhost:5173`, public storefront on `http://localhost:5174`, API on `http://localhost:3000`.

For SePay and Telegram webhooks during local development, expose the API/bot ports through a public HTTPS tunnel such as ngrok or cloudflared.

## Deployment

- Render + Vercel: see `docs/deploy-render.md` and `docs/deploy-web-vercel.md`.
- VPS production without cold start: see `docs/deploy-vps.md`.

After a production deploy, run:

```bash
pnpm smoke:prod
```

This checks the storefront, admin app, API health, public catalog, auth guard, and storefront CSS constraints.
