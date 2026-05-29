# Deploy VPS Production

Huong dan hien tai: storefront web van chay tren Vercel, con API, admin static va Telegram bot chay tren VPS. Database production dung Neon PostgreSQL, Redis chay local tren VPS.

## Trang thai VPS da setup

- Ubuntu 24.04
- Node.js 22, pnpm 11.3.0
- Nginx, Redis, PostgreSQL local da cai. PostgreSQL local khong phai database production.
- API service: `vd-store-api`
- Bot service: `vd-store-bot`
- Thu muc app: `/opt/vd-store`
- Env production: `/opt/vd-store/.env`

Khong sua/xoa file `.env` tren VPS khi deploy code moi.

## Domain can tro ve VPS

Giu storefront tren Vercel:

```text
vanhdao.io.vn      -> giu record dang tro Vercel
www.vanhdao.io.vn  -> giu record dang tro Vercel neu dang dung
```

Tro cac subdomain backend/admin/bot ve VPS:

```text
A     api     45.76.191.168
A     admin   45.76.191.168
A     bot     45.76.191.168
AAAA  api     2401:c080:1400:18dd:5400:06ff:fe32:ce22   # optional
AAAA  admin   2401:c080:1400:18dd:5400:06ff:fe32:ce22   # optional
AAAA  bot     2401:c080:1400:18dd:5400:06ff:fe32:ce22   # optional
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

Bot Telegram chi nen bat sau khi DNS + SSL cua `bot.vanhdao.io.vn` da xong va bot cu tren Render da tat:

```bash
systemctl enable --now vd-store-bot
journalctl -u vd-store-bot -n 100 --no-pager
```

Neu bat bot qua som, Telegram webhook co the bi chuyen khoi Render sang domain chua san sang.

## CI/CD GitHub Actions

Workflow `.github/workflows/deploy-vps.yml` deploy bang SSH/SCP, khong can VPS clone repo private. Them cac secret sau trong GitHub repo:

```text
VPS_HOST=45.76.191.168
VPS_USER=root
VPS_PORT=22
VPS_SSH_KEY=<private key tuong ung voi public key da them vao VPS>
```

Moi lan push `main`, workflow se:

1. Dong goi source code, khong kem `.env`.
2. Upload len VPS.
3. Copy lai `.env` hien co tren VPS vao ban release moi.
4. Chay `pnpm install`, `prisma migrate deploy`, seed, build API/bot/admin.
5. Restart API; bot chi restart neu dang active truoc do.

## Lenh kiem tra

Khi DNS chua tro, co the test qua IP voi Host header:

```bash
curl -H 'Host: api.vanhdao.io.vn' http://45.76.191.168/health
curl -H 'Host: admin.vanhdao.io.vn' http://45.76.191.168/
```

Sau khi DNS + SSL:

```bash
curl https://api.vanhdao.io.vn/health
curl -I https://admin.vanhdao.io.vn
journalctl -u vd-store-api -n 100 --no-pager
journalctl -u vd-store-bot -n 100 --no-pager
```
