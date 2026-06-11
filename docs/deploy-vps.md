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
