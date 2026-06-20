# Deploy VPS Production

Storefront chay tren Vercel. API, admin static, Telegram bot, PostgreSQL va Redis chay tren VPS.

## Trang thai VPS da setup

- Ubuntu 24.04
- Node.js 22, pnpm 11.3.0
- Nginx va Redis local.
- PostgreSQL 17 production tai `127.0.0.1:5432`, database `vdstore`.
- API service: `vd-store-api`
- Bot service: `vd-store-bot`
- Thu muc app: `/opt/vd-store`
- Env production: `/opt/vd-store/.env`
- Thu muc backup database: `/opt/vd-store-backups`

Khong sua/xoa file `.env` tren VPS khi deploy code moi.
PostgreSQL chi lang nghe local; khong mo cong 5432 ra Internet.

## Google Analytics trong admin

Storefront gui su kien vao measurement ID `G-CFYXXY4CYJ`. Admin doc bao cao
property `249898520` qua Google Analytics Data API.

1. Trong Google Cloud, bat `Google Analytics Data API`.
2. Tao service account va tai JSON key.
3. Trong GA4 Property > Quan ly quyen truy cap vao tai san, them email service
   account voi quyen `Viewer`.
4. Dat key tren VPS, khong dat trong repository:

   ```bash
   sudo install -d -m 700 /etc/vd-store
   sudo install -m 600 google-analytics-service-account.json \
     /etc/vd-store/google-analytics-service-account.json
   ```

5. Them vao `/opt/vd-store/.env`:

   ```env
   GA_PROPERTY_ID=249898520
   GOOGLE_APPLICATION_CREDENTIALS=/etc/vd-store/google-analytics-service-account.json
   ```

6. Restart API:

   ```bash
   sudo systemctl restart vd-store-api
   ```

Neu key chua co, tab Phan tich hien huong dan cau hinh va cac luong khac van
hoat dong binh thuong.

## Domain can tro ve VPS

Giu storefront tren Vercel:

```text
vanhdao.io.vn      -> giu record dang tro Vercel
www.vanhdao.io.vn  -> giu record dang tro Vercel neu dang dung
```

Tro cac subdomain backend/admin/bot ve VPS:

```text
A     api     160.191.50.142
A     admin   160.191.50.142
A     bot     160.191.50.142
```

Sau khi DNS propagate, cai SSL:

```bash
certbot --nginx -d api.vanhdao.io.vn -d admin.vanhdao.io.vn -d bot.vanhdao.io.vn
```

## SePay va Telegram

SePay webhook:

```text
URL: https://api.vanhdao.io.vn/webhooks/sepay
Loai giao dich: Tien vao
Dinh dang: JSON
Xac thuc: HMAC-SHA256
Loc ma thanh toan: NAP, DH
```

Bot Telegram chi nen bat sau khi DNS + SSL cua `bot.vanhdao.io.vn` da xong:

```bash
systemctl enable --now vd-store-bot
journalctl -u vd-store-bot -n 100 --no-pager
```

Bot thong bao don can admin giao:

1. Vao Telegram mo `@BotFather`, chay `/newbot`, tao bot rieng vi du
   `VD Store Admin Alert`.
2. Copy token moi vao `/opt/vd-store/.env`:

   ```env
   ADMIN_TELEGRAM_BOT_TOKEN=123456:abc...
   ADMIN_TELEGRAM_CHAT_ID=123456789
   ADMIN_PUBLIC_URL=https://admin.vanhdao.io.vn
   ```

   Neu `ADMIN_TELEGRAM_BOT_TOKEN` de trong, API se fallback ve
   `TELEGRAM_BOT_TOKEN` cu de tranh mat thong bao.

3. De lay `ADMIN_TELEGRAM_CHAT_ID`, admin phai bam Start voi bot moi truoc,
   sau do goi:

   ```bash
   curl "https://api.telegram.org/bot<ADMIN_TELEGRAM_BOT_TOKEN>/getUpdates"
   ```

   Lay gia tri numeric `message.chat.id`. Neu dung group rieng cho admin,
   them bot vao group, gui mot tin nhan trong group, roi lay `chat.id` am.
   Khong dien `@username` vao `ADMIN_TELEGRAM_CHAT_ID` vi bot Telegram
   khong the DM username neu chua co chat id.

4. Restart API de nhan env moi:

   ```bash
   systemctl restart vd-store-api
   journalctl -u vd-store-api -n 100 --no-pager
   ```

Khi co don san pham giao thu cong (`MANUAL`) duoc thanh toan thanh cong
hoac don CTV live co item can admin giao, API se gui tin vao bot admin
rieng voi ma don, san pham, so luong, so tien va thong tin khach.

## CI/CD GitHub Actions

Workflow `.github/workflows/deploy-vps.yml` deploy bang SSH/SCP, khong can VPS clone repo private. Them cac secret sau trong GitHub repo:

```text
VPS_HOST=160.191.50.142
VPS_USER=root
VPS_PORT=22
VPS_SSH_KEY=<private key tuong ung voi public key da them vao VPS>
```

Moi lan push `main`, workflow se:

1. Dong goi source code, khong kem `.env`.
2. Upload len VPS.
3. Copy lai `.env` hien co tren VPS vao ban release moi.
4. Xac nhan PostgreSQL local san sang, chay `pnpm install`, `prisma migrate deploy`, seed, build API/bot/admin.
5. Restart API; bot chi restart neu dang active truoc do.

## Database

Kiem tra:

```bash
systemctl status postgresql
pg_isready -h 127.0.0.1 -p 5432
sudo -u postgres psql -d vdstore -c "select now();"
```

Backup:

```bash
bash /opt/vd-store/scripts/backup-postgres-vps.sh
ls -lh /var/backups/vd-store-postgres
```

VPS chay `vd-store-postgres-backup.timer` moi ngay. File backup duoc kiem tra bang
`pg_restore --list` va giu 14 ngay.

## Lenh kiem tra

Khi DNS chua tro, test qua IP voi Host header:

```bash
curl -H 'Host: api.vanhdao.io.vn' http://160.191.50.142/health
curl -H 'Host: admin.vanhdao.io.vn' http://160.191.50.142/
```

Sau khi DNS + SSL:

```bash
curl https://api.vanhdao.io.vn/health
curl -I https://admin.vanhdao.io.vn
journalctl -u vd-store-api -n 100 --no-pager
journalctl -u vd-store-bot -n 100 --no-pager
```
