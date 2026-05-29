# Deploy VPS Production

Huong dan nay danh cho VPS Ubuntu 22.04/24.04 de chay API, bot Telegram, PostgreSQL, Redis va serve web/admin static. Muc tieu la tranh cold start cua Render Free va dung domain `vanhdao.io.vn`.

## Cau hinh khuyen nghi

- Toi thieu: 1 CPU, 1GB RAM, bat swap 2GB.
- Khuyen nghi: 1 CPU, 2GB RAM tro len.
- Neu dung 1GB RAM, khong build nhieu service cung luc va nen build frontend truoc roi moi restart service.

## Domain can tro ve VPS

Tao cac record DNS:

```text
A     @       <IP_VPS>
A     www     <IP_VPS>
A     api     <IP_VPS>
A     admin   <IP_VPS>
```

Sau khi tro DNS, URL dung cho production:

```text
Storefront: https://vanhdao.io.vn
Admin:      https://admin.vanhdao.io.vn
API:        https://api.vanhdao.io.vn
SePay:      https://api.vanhdao.io.vn/webhooks/sepay
```

## Chuan bi VPS 1GB RAM

```bash
sudo apt update
sudo apt install -y curl git nginx postgresql postgresql-contrib redis-server
```

Bat swap 2GB:

```bash
sudo fallocate -l 2G /swapfile
sudo chmod 600 /swapfile
sudo mkswap /swapfile
sudo swapon /swapfile
echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab
```

Cai Node.js 22 va pnpm:

```bash
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt install -y nodejs
corepack enable
corepack prepare pnpm@11.3.0 --activate
```

## Tao database

```bash
sudo -u postgres psql
```

Trong PostgreSQL shell:

```sql
CREATE USER vdstore WITH PASSWORD 'doi-mat-khau-db-manh';
CREATE DATABASE vdstore OWNER vdstore;
\q
```

DATABASE_URL:

```text
postgresql://vdstore:doi-mat-khau-db-manh@localhost:5432/vdstore?schema=public
```

Redis URL:

```text
redis://localhost:6379
```

## Lay source va build

```bash
sudo mkdir -p /opt/vd-store
sudo chown -R $USER:$USER /opt/vd-store
git clone https://github.com/vanhub03/vd-store.git /opt/vd-store
cd /opt/vd-store
pnpm install --frozen-lockfile
```

Tao file `.env` tren VPS theo `.env.example`. Gia tri production quan trong:

```text
NODE_ENV=production
API_BASE_URL=https://api.vanhdao.io.vn
VITE_API_BASE_URL=https://api.vanhdao.io.vn

DATABASE_URL=postgresql://vdstore:doi-mat-khau-db-manh@localhost:5432/vdstore?schema=public
REDIS_URL=redis://localhost:6379

BOT_INTERNAL_TOKEN=<chuoi-ngau-nhien-manh>
JWT_SECRET=<chuoi-ngau-nhien-manh>

ADMIN_EMAIL=<email-admin>
ADMIN_PASSWORD=<mat-khau-admin>
ADMIN_TELEGRAM_USERNAME=vanhdao99
ADMIN_TELEGRAM_CHAT_ID=<chat-id-admin-neu-muon-bot-nhan-rieng>

TELEGRAM_BOT_TOKEN=<token-bot>
TELEGRAM_BOT_MODE=webhook
TELEGRAM_WEBHOOK_PUBLIC_URL=https://bot.vanhdao.io.vn
TELEGRAM_WEBHOOK_PATH=/telegram/webhook
BOT_PORT=3001

SEPAY_AUTH_MODE=hmac
SEPAY_WEBHOOK_SECRET=<secret-hmac-tren-sepay>
SEPAY_API_KEY=<api-key-neu-dung-mode-api-key>
SEPAY_ACCOUNT_NUMBER=03219071601

VIETQR_BANK_CODE=TPB
VIETQR_ACCOUNT_NUMBER=03219071601
VIETQR_ACCOUNT_NAME=VANH DAO
VIETQR_TEMPLATE=compact2
VIETQR_IMAGE_BASE_URL=https://img.vietqr.io/image
```

Chay migrate, seed va build:

```bash
pnpm prisma:generate
pnpm --filter @vd-store/api exec prisma migrate deploy
pnpm prisma:seed
pnpm --filter @vd-store/api build
pnpm --filter @vd-store/bot build
pnpm --filter @vd-store/admin build
pnpm --filter @vd-store/web build
```

## Chay API va Bot bang systemd

Tao API service:

```bash
sudo tee /etc/systemd/system/vd-store-api.service >/dev/null <<'EOF'
[Unit]
Description=VD Store API
After=network.target postgresql.service redis-server.service

[Service]
Type=simple
WorkingDirectory=/opt/vd-store
EnvironmentFile=/opt/vd-store/.env
ExecStart=/usr/bin/pnpm --filter @vd-store/api start
Restart=always
RestartSec=5
MemoryMax=420M

[Install]
WantedBy=multi-user.target
EOF
```

Tao bot service:

```bash
sudo tee /etc/systemd/system/vd-store-bot.service >/dev/null <<'EOF'
[Unit]
Description=VD Store Telegram Bot
After=network.target vd-store-api.service

[Service]
Type=simple
WorkingDirectory=/opt/vd-store
EnvironmentFile=/opt/vd-store/.env
ExecStart=/usr/bin/pnpm --filter @vd-store/bot start
Restart=always
RestartSec=5
MemoryMax=260M

[Install]
WantedBy=multi-user.target
EOF
```

Bat service:

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now vd-store-api vd-store-bot
sudo systemctl status vd-store-api --no-pager
sudo systemctl status vd-store-bot --no-pager
```

## Nginx reverse proxy va static web

Neu khong them duoc custom domain tren Render/Vercel, VPS co the host tat ca domain.

```bash
sudo tee /etc/nginx/sites-available/vd-store >/dev/null <<'EOF'
server {
  listen 80;
  server_name vanhdao.io.vn www.vanhdao.io.vn;
  root /opt/vd-store/apps/web/dist;
  index index.html;

  location / {
    try_files $uri $uri/ /index.html;
  }
}

server {
  listen 80;
  server_name admin.vanhdao.io.vn;
  root /opt/vd-store/apps/admin/dist;
  index index.html;

  location / {
    try_files $uri $uri/ /index.html;
  }
}

server {
  listen 80;
  server_name api.vanhdao.io.vn;

  location / {
    proxy_pass http://127.0.0.1:3000;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
  }
}

server {
  listen 80;
  server_name bot.vanhdao.io.vn;

  location / {
    proxy_pass http://127.0.0.1:3001;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
  }
}
EOF

sudo ln -sf /etc/nginx/sites-available/vd-store /etc/nginx/sites-enabled/vd-store
sudo nginx -t
sudo systemctl reload nginx
```

Cai SSL mien phi:

```bash
sudo apt install -y certbot python3-certbot-nginx
sudo certbot --nginx -d vanhdao.io.vn -d www.vanhdao.io.vn -d admin.vanhdao.io.vn -d api.vanhdao.io.vn -d bot.vanhdao.io.vn
```

## Cau hinh SePay va Telegram

SePay webhook:

```text
URL: https://api.vanhdao.io.vn/webhooks/sepay
Loai giao dich: Tien vao
Dinh dang: JSON
Xac thuc: HMAC-SHA256
Loc ma thanh toan: NAP, DH
```

Telegram bot dung webhook se tu set webhook khi `vd-store-bot` start, voi:

```text
TELEGRAM_WEBHOOK_PUBLIC_URL=https://bot.vanhdao.io.vn
TELEGRAM_WEBHOOK_PATH=/telegram/webhook
```

## Deploy update moi

```bash
cd /opt/vd-store
git pull
pnpm install --frozen-lockfile
pnpm prisma:generate
pnpm --filter @vd-store/api exec prisma migrate deploy
pnpm --filter @vd-store/api build
pnpm --filter @vd-store/bot build
pnpm --filter @vd-store/admin build
pnpm --filter @vd-store/web build
sudo systemctl restart vd-store-api vd-store-bot
sudo systemctl reload nginx
```

## Kiem tra production

```bash
curl -I https://vanhdao.io.vn
curl https://api.vanhdao.io.vn/health
sudo journalctl -u vd-store-api -n 100 --no-pager
sudo journalctl -u vd-store-bot -n 100 --no-pager
```

Neu bot cham tren VPS 1GB, kiem tra RAM:

```bash
free -h
sudo journalctl -u vd-store-api -p warning -n 50 --no-pager
sudo journalctl -u vd-store-bot -p warning -n 50 --no-pager
```

Neu RAM con duoi 150MB trong luc idle, nen nang len 2GB.
