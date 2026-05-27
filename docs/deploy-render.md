# Deploy VD Store on Render Free

Render is the recommended free deployment target for this project because it can run Node web services, PostgreSQL, Redis-compatible Key Value, custom domains, and TLS from one place.

## Target URLs

- Admin dashboard: `https://admin.vanhdao.io.vn`
- API and SePay webhook: `https://api.vanhdao.io.vn`
- Telegram bot webhook: Render default domain, usually `https://vd-store-bot.onrender.com`

The Render Hobby plan includes 2 custom domains. This config uses them for `admin` and `api`. The bot can use the default Render domain because Telegram does not require your own domain.

## Deploy Steps

1. Push this repo to GitHub.
2. Create a Render account and choose **New > Blueprint**.
3. Select the GitHub repo and use the root `render.yaml`.
4. When Render asks for secret env vars, fill:

   ```env
   ADMIN_PASSWORD=your_strong_admin_password
   TELEGRAM_BOT_TOKEN=your_telegram_bot_token
   SEPAY_WEBHOOK_SECRET=your_sepay_hmac_secret
   SEPAY_API_KEY=
   SEPAY_ACCOUNT_NUMBER=your_bank_account_number
   VIETQR_BANK_CODE=TPB
   VIETQR_ACCOUNT_NUMBER=your_bank_account_number
   VIETQR_ACCOUNT_NAME=VANH DAO
   ```

5. On the first successful API deploy, Render runs the seed command automatically and creates the first admin account from `ADMIN_EMAIL` and `ADMIN_PASSWORD`.

6. Check health:

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
