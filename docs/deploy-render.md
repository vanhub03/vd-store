# Deploy VD Store on Render Free

Render is the recommended free deployment target for this project because it can run Node web services, Redis-compatible Key Value, custom domains, and TLS from one place.

If your Render workspace has already used all free custom-domain slots, keep API/admin on Render and deploy the public storefront on Vercel Free instead. See `docs/deploy-web-vercel.md`.

Use an external managed PostgreSQL provider such as Neon or Supabase for `DATABASE_URL`. Render Free Postgres works for tests, but it has limits such as one active free database per workspace and 30-day expiration, so this project does not create a Render database in the Blueprint.

## Target URLs

- Admin dashboard: `https://admin.vanhdao.io.vn`
- Public storefront: `https://vanhdao.io.vn`
- API and SePay webhook: `https://api.vanhdao.io.vn`
- Telegram bot webhook: Render default domain, usually `https://vd-store-bot.onrender.com`

The bot can use the default Render domain because Telegram does not require your own domain. The Blueprint also creates a static storefront service for the root domain.

## Deploy Steps

1. Push this repo to GitHub.
2. Create a Render account and choose **New > Blueprint**.
3. Select the GitHub repo and use the root `render.yaml`.
4. Create a free PostgreSQL database on Neon or Supabase and copy its PostgreSQL connection string.

5. When Render asks for secret env vars, fill:

   ```env
   DATABASE_URL=postgresql://...
   ADMIN_EMAIL=your_admin_email
   ADMIN_PASSWORD=your_strong_admin_password
   TELEGRAM_BOT_TOKEN=your_telegram_bot_token
   SEPAY_WEBHOOK_SECRET=your_sepay_hmac_secret
   SEPAY_API_KEY=
   SEPAY_ACCOUNT_NUMBER=your_bank_account_number
   VIETQR_BANK_CODE=TPB
   VIETQR_ACCOUNT_NUMBER=your_bank_account_number
   VIETQR_ACCOUNT_NAME=VANH DAO
   ADMIN_TELEGRAM_CHAT_ID=your_private_or_group_chat_id
   ```

   `ADMIN_TELEGRAM_CHAT_ID` is recommended for manual-delivery order alerts. A username such as `@vanhdao99` is not always enough for Bot API private messages unless Telegram has an addressable chat id.

6. On API startup, Render runs Prisma migrations and the seed command automatically. This creates or updates the first admin account from `ADMIN_EMAIL` and `ADMIN_PASSWORD`.

7. Check health:

   ```text
   https://api.vanhdao.io.vn/health
   https://vd-store-bot.onrender.com/health
   ```

## DNS At Nhan Hoa

In Nhan Hoa DNS management, add these records after Render creates the services:

```text
Type: CNAME
Name: api
Value: vd-store-api.onrender.com
TTL: Auto or 300
```

```text
Type: CNAME
Name: admin
Value: vd-store-admin.onrender.com
TTL: Auto or 300
```

For the root storefront domain, Render usually asks for one of these records on the `vd-store-web` domain page. Use the exact value Render shows:

```text
Type: CNAME
Name: @
Value: vd-store-web.onrender.com
TTL: Auto or 300
```

If Nhan Hoa does not allow CNAME at root, use the A records Render displays for apex/root domains instead. After adding the record, open Render > `vd-store-web` > Settings > Custom Domains and click verify.

Then go back to Render service settings and verify the custom domains. Render will issue TLS automatically.

## SePay Webhook

Set the SePay webhook URL to:

```text
https://api.vanhdao.io.vn/webhooks/sepay
```

Use:

```text
Loại giao dịch: Tiền vào
Định dạng dữ liệu: JSON
Bảo mật: HMAC-SHA256
```

The HMAC secret in SePay must match `SEPAY_WEBHOOK_SECRET` in Render.

## Telegram Webhook

The bot service sets the Telegram webhook on boot using:

```text
TELEGRAM_WEBHOOK_PUBLIC_URL=https://vd-store-bot.onrender.com
TELEGRAM_WEBHOOK_PATH=/telegram/webhook
```

If Render assigns a different default domain, update `TELEGRAM_WEBHOOK_PUBLIC_URL` in the `vd-store-bot` service.
