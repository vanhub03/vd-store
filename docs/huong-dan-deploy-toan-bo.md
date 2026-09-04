# Hướng dẫn triển khai VD Store từ A–Z

Tài liệu này hướng dẫn dựng mới, cấu hình, vận hành và khôi phục môi trường production cho VD Store. Mọi giá trị có dạng `<...>` là **placeholder**: thay bằng thông tin của bạn, không commit vào Git và không gửi trong chat.

> Phạm vi: website bán hàng, API, Admin, Telegram Bot, PostgreSQL, Redis, SePay/VietQR, USDT (Cryptomus), Partner API cho CTV, backup, giám sát và CI/CD.

## 1. Kiến trúc chuẩn

| Thành phần | Nơi chạy | Domain production hiện dùng | Vai trò |
|---|---|---|---|
| Website khách hàng | Vercel | `https://www.vanhdao.io.vn` | Storefront React/Vite, SEO và checkout |
| API | VPS | `https://api.vanhdao.io.vn` | Đơn hàng, ví, thanh toán, webhook, Partner API |
| Admin | VPS | `https://admin.vanhdao.io.vn` | Quản trị sản phẩm, đơn, CTV, ví và báo cáo |
| Telegram Bot | VPS | `https://bot.vanhdao.io.vn` (khi dùng webhook) | Bot bán hàng và health endpoint |
| PostgreSQL + Redis | VPS, chỉ local | Không public | Dữ liệu chính và queue/rate limit |

Luồng chính:

```text
Khách ──> Website (Vercel) ──HTTPS──> API (VPS) ──> PostgreSQL / Redis
                                           │
                       SePay / Cryptomus ─┼─> webhook thanh toán
                                           │
                                Admin / Telegram Bot
```

Không deploy Admin, API hoặc Bot lên Vercel. Vercel chỉ build thư mục `apps/web` theo `vercel.json`.

## 2. Chuẩn bị trước khi bắt đầu

Bạn cần có:

- VPS Ubuntu 24.04 hoặc Ubuntu LTS tương đương, ít nhất 2 vCPU, 4 GB RAM và SSD 40 GB trở lên.
- Domain đã quản lý DNS; quyền tạo subdomain và bản ghi DNS.
- Repository GitHub `vanhub03/vd-store` và quyền quản trị repo.
- Tài khoản Vercel để chạy website khách hàng.
- Tài khoản SePay và ngân hàng nhận tiền; Cryptomus nếu bật USDT.
- Bot Telegram chính; có thể tạo bot Telegram riêng chỉ để báo Admin.
- Một máy quản trị có SSH key. Không dùng mật khẩu SSH trong CI/CD.

Chọn và lưu các secret trong password manager trước khi chạy lệnh:

- Mật khẩu PostgreSQL mạnh.
- `JWT_SECRET`, `BOT_INTERNAL_TOKEN`, `PARTNER_WEBHOOK_ENCRYPTION_KEY`: mỗi biến là chuỗi ngẫu nhiên khác nhau, tối thiểu 32 byte.
- Mật khẩu Admin ban đầu mạnh.
- Token Telegram, SePay, Cryptomus, Google service account (nếu có).

Tạo chuỗi ngẫu nhiên trên VPS hoặc máy cá nhân, rồi chỉ dán vào file `.env`:

```bash
openssl rand -base64 48
```

## 3. DNS và mạng

### 3.1. Bản ghi DNS

Giữ domain gốc cho Vercel. Trỏ các subdomain backend về IP VPS:

```text
vanhdao.io.vn       -> theo record Vercel cung cấp
www.vanhdao.io.vn   -> theo record Vercel cung cấp

A  api              -> <VPS_PUBLIC_IP>
A  admin            -> <VPS_PUBLIC_IP>
A  bot              -> <VPS_PUBLIC_IP>
```

Nếu triển khai domain khác, thay `vanhdao.io.vn` ở toàn bộ file `.env`, Nginx, Vercel và các cổng webhook. Chỉ cấp SSL sau khi DNS của `api`, `admin`, `bot` đã phân giải đúng IP:

```bash
nslookup api.<domain>
nslookup admin.<domain>
nslookup bot.<domain>
```

### 3.2. Firewall và SSH

Đăng nhập VPS bằng tài khoản có quyền `sudo`, cập nhật hệ thống và chỉ mở các cổng cần thiết:

```bash
sudo apt update && sudo apt upgrade -y
sudo apt install -y ufw ca-certificates curl gnupg
sudo ufw allow OpenSSH
sudo ufw allow 'Nginx Full'
sudo ufw enable
sudo ufw status verbose
```

Không mở công khai các cổng `3000`, `3001`, `5432` hoặc `6379`. Nginx là điểm vào HTTPS duy nhất. Sau khi xác nhận SSH key hoạt động, nên tắt đăng nhập root bằng mật khẩu và tắt password authentication trong `/etc/ssh/sshd_config`, sau đó kiểm tra bằng một phiên SSH thứ hai trước khi đóng phiên hiện tại.

Kiểm tra đồng hồ hệ thống (webhook chữ ký phụ thuộc thời gian chính xác):

```bash
timedatectl status
sudo timedatectl set-ntp true
```

## 4. Cài runtime trên VPS

### 4.1. Gói hệ thống và Node.js

```bash
sudo apt install -y nginx redis-server postgresql postgresql-contrib \
  certbot python3-certbot-nginx git build-essential

curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt install -y nodejs
node --version
corepack enable
corepack prepare pnpm@11.3.0 --activate
pnpm --version
```

Phiên bản `pnpm` cần khớp với trường `packageManager` trong `package.json`. Không cài dependency production bằng `npm install` vì project dùng `pnpm-lock.yaml`.

Khởi động các dịch vụ nền và kiểm tra:

```bash
sudo systemctl enable --now postgresql redis-server nginx
sudo systemctl status postgresql redis-server nginx --no-pager
redis-cli ping
```

Kết quả Redis mong đợi là `PONG`.

### 4.2. PostgreSQL

Tạo user/database application. Lệnh bên dưới không in mật khẩu ra terminal history; PostgreSQL sẽ hỏi mật khẩu tương tác.

```bash
sudo -u postgres createuser --pwprompt vdstore
sudo -u postgres createdb -O vdstore vdstore
sudo -u postgres psql -d vdstore -c 'SELECT current_database(), current_user;'
```

Mặc định PostgreSQL phải chỉ lắng nghe local. Kiểm tra:

```bash
sudo ss -lntp | grep 5432
```

Kết quả phải là `127.0.0.1:5432` và/hoặc `::1:5432`, không phải `0.0.0.0:5432`.

## 5. Lấy mã nguồn và tạo file môi trường

### 5.1. Cài source lần đầu

VPS hiện tại dùng `/opt/vd-store`. Khi dựng mới:

```bash
sudo mkdir -p /opt
sudo git clone https://github.com/vanhub03/vd-store.git /opt/vd-store
sudo chown -R "$USER":"$USER" /opt/vd-store
cd /opt/vd-store
corepack enable
corepack prepare pnpm@11.3.0 --activate
pnpm install --frozen-lockfile
```

Nếu repository private, dùng deploy key hoặc GitHub App token có quyền đọc repo. Không nhúng PAT vào URL remote.

### 5.2. Tạo `.env` bảo mật

File production duy nhất là `/opt/vd-store/.env`; nó bị `.gitignore` loại trừ và workflow deploy sẽ sao chép nó vào API/Bot của bản release mới.

```bash
cd /opt/vd-store
cp .env.example .env
nano .env
chmod 600 .env
```

Mẫu tối thiểu (chỉ minh hoạ, không dùng nguyên văn secret):

```env
NODE_ENV=production
PORT=3000
API_BASE_URL=https://api.<domain>
WEB_PUBLIC_URL=https://www.<domain>

DATABASE_URL=postgresql://vdstore:<URL_ENCODED_DB_PASSWORD>@127.0.0.1:5432/vdstore?schema=public
REDIS_URL=redis://127.0.0.1:6379

JWT_SECRET=<random-secret-1>
BOT_INTERNAL_TOKEN=<random-secret-2>
PARTNER_API_ENABLED=true
PARTNER_WEBHOOK_ENCRYPTION_KEY=<random-secret-3>
PARTNER_WEBHOOK_CONCURRENCY=5

ADMIN_EMAIL=<admin-email>
ADMIN_PASSWORD=<strong-initial-admin-password>

VITE_API_BASE_URL=https://api.<domain>
ADMIN_PUBLIC_URL=https://admin.<domain>
```

Lưu ý quan trọng:

- Encode các ký tự đặc biệt trong mật khẩu database khi đặt vào URL, ví dụ `@` thành `%40`.
- `ADMIN_PASSWORD` được seed sử dụng ở mỗi deploy. Hãy giữ biến này là mật khẩu quản trị hiện hành, đủ mạnh và chỉ thay có chủ đích; không xoá hoặc để giá trị mẫu.
- Không bọc giá trị bằng dấu nháy nếu password có thể gây lỗi parser. Không để khoảng trắng thừa cuối dòng.
- Không copy `.env` vào Git, Vercel, ảnh chụp màn hình hoặc log CI.

Để chạy thủ công Prisma và Bot cùng đọc cấu hình, tạo bản sao local được ignore:

```bash
cp .env apps/api/.env
cp .env apps/bot/.env
chmod 600 apps/api/.env apps/bot/.env
```

## 6. Cấu hình các tích hợp trong `.env`

### 6.1. VietQR và SePay

Điền thông tin ngân hàng đang nhận tiền và xác thực webhook SePay:

```env
SEPAY_AUTH_MODE=hmac
SEPAY_WEBHOOK_SECRET=<sepay-hmac-secret>
SEPAY_API_KEY=<sepay-api-key-if-provider-mode-requires-it>
SEPAY_ACCOUNT_NUMBER=<bank-account-number>

VIETQR_BANK_CODE=<bank-code>
VIETQR_ACCOUNT_NUMBER=<bank-account-number>
VIETQR_ACCOUNT_NAME=<account-holder-name>
VIETQR_TEMPLATE=compact2
VIETQR_IMAGE_BASE_URL=https://img.vietqr.io/image
```

Trong trang SePay, cấu hình webhook:

```text
URL:        https://api.<domain>/webhooks/sepay
Giao dịch:  chỉ tiền vào
Format:     JSON
Xác thực:   HMAC-SHA256 (khuyến nghị)
Từ khoá:    NAP, DH
```

Đồng bộ số tài khoản ở `SEPAY_ACCOUNT_NUMBER` và `VIETQR_ACCOUNT_NUMBER`; nếu thay ngân hàng, đổi cả hai rồi restart API. Giữ phương thức cũ cho đến khi một giao dịch nạp thử vào tài khoản mới đã được cộng ví chính xác. Không bật quét giao dịch đi nếu không cần, vì một số gói SePay tính số lần đồng bộ trên mọi giao dịch tài khoản.

Webhook SePay hợp lệ cần đi vào API, không phải domain web/admin/bot. Một webhook không ký, sai secret, sai số tài khoản hoặc giao dịch trùng phải bị từ chối/bỏ qua; không cộng ví thủ công trước khi đối soát.

### 6.2. USDT qua Cryptomus (tuỳ chọn)

Nếu chưa dùng USDT, để trống các biến Cryptomus. Nếu bật:

```env
CRYPTOMUS_MERCHANT_ID=<merchant-id>
CRYPTOMUS_PAYMENT_API_KEY=<payment-api-key>
CRYPTOMUS_WEBHOOK_AUTH_MODE=sign
CRYPTOMUS_API_BASE_URL=https://api.cryptomus.com
CRYPTOMUS_NETWORK=bsc
CRYPTOMUS_WEBHOOK_URL=https://api.<domain>/webhooks/cryptomus
CRYPTOMUS_RETURN_URL=https://www.<domain>
CRYPTOMUS_SUCCESS_URL=https://www.<domain>
USDT_VND_RATE=<initial-vnd-per-usdt>
```

Sau khi deploy, ưu tiên quản lý tỷ giá tại Admin; hệ thống lưu snapshot tỷ giá trên từng giao dịch. Chỉ Cryptomus webhook hợp lệ mới được cộng ví. Không chỉnh sửa số tiền giao dịch trực tiếp trong database.

### 6.3. Telegram Bot bán hàng

Tạo bot với `@BotFather`, lấy token và cấu hình một trong hai chế độ:

```env
TELEGRAM_BOT_TOKEN=<main-bot-token>
TELEGRAM_BOT_MODE=polling
BOT_PORT=3001
ADMIN_TELEGRAM_USERNAME=<support-username-without-@>
```

`polling` là lựa chọn đơn giản nhất cho một VPS và chỉ được chạy **một** instance Bot. Nếu dùng webhook, thay bằng:

```env
TELEGRAM_BOT_MODE=webhook
TELEGRAM_WEBHOOK_PUBLIC_URL=https://bot.<domain>
TELEGRAM_WEBHOOK_PATH=/telegram/webhook
BOT_PORT=3001
```

Không chạy polling và webhook đồng thời với cùng token, cũng không khởi động hai service Bot với cùng token.

### 6.4. Bot cảnh báo Admin

Bot này thông báo đơn cần giao thủ công và hạn gia hạn sản phẩm. Nên dùng bot riêng:

```env
ADMIN_TELEGRAM_BOT_TOKEN=<admin-alert-bot-token>
ADMIN_TELEGRAM_CHAT_ID=<numeric-private-or-group-chat-id>
ADMIN_PUBLIC_URL=https://admin.<domain>
```

Để lấy Chat ID: nhắn `/start` hoặc một tin bất kỳ cho bot, rồi từ máy tin cậy gọi:

```bash
curl "https://api.telegram.org/bot<ADMIN_TELEGRAM_BOT_TOKEN>/getUpdates"
```

Lấy giá trị `message.chat.id`. Với group, thêm bot vào group, gửi tin nhắn trong group, giá trị thường là số âm. Không dùng `@username`: Telegram không cho bot tự DM một username khi chưa có chat ID.

Sau mỗi thay đổi token/chat ID, restart API. Nếu để trống `ADMIN_TELEGRAM_BOT_TOKEN`, API chỉ fallback sang bot chính; nếu thiếu `ADMIN_TELEGRAM_CHAT_ID`, đơn vẫn nằm trong Admin nhưng sẽ không có alert Telegram.

### 6.5. Google Analytics trong Admin (tuỳ chọn)

Để màn phân tích Admin đọc GA4 Data API:

1. Trong Google Cloud, bật **Google Analytics Data API**.
2. Tạo service account, cấp quyền `Viewer` trên GA4 Property.
3. Lưu JSON key ngoài source code:

   ```bash
   sudo install -d -m 700 /etc/vd-store
   sudo install -m 600 /path/to/google-analytics-service-account.json \
     /etc/vd-store/google-analytics-service-account.json
   ```

4. Thêm vào `.env`:

   ```env
   GA_PROPERTY_ID=<ga4-property-id>
   GOOGLE_APPLICATION_CREDENTIALS=/etc/vd-store/google-analytics-service-account.json
   ```

`VITE_GA_MEASUREMENT_ID` là mã public có thể đặt trong Vercel; JSON service account là secret tuyệt đối không đặt vào Vercel hoặc repository.

## 7. Database migration, seed và build đầu tiên

Sau khi hoàn tất `.env`, chạy theo đúng thứ tự:

```bash
cd /opt/vd-store
pnpm prisma:generate
pnpm --filter @vd-store/api exec prisma migrate deploy
pnpm --filter @vd-store/api prisma:seed
pnpm --filter @vd-store/api build
pnpm --filter @vd-store/bot build
VITE_API_BASE_URL=https://api.<domain> pnpm --filter @vd-store/admin build
```

`migrate deploy` chỉ áp dụng migration có sẵn, phù hợp production. Không chạy `prisma migrate dev` trên production.

Seed tạo/cập nhật tài khoản Admin và dữ liệu demo khi cần. Nếu đây là database thật đang có dữ liệu, backup trước và đọc [runbook migration PostgreSQL](./postgres-migration-runbook.md) trước khi import/cutover.

## 8. Tạo service systemd

Tạo API service `/etc/systemd/system/vd-store-api.service`:

```ini
[Unit]
Description=VD Store API
After=network-online.target postgresql.service redis-server.service
Wants=network-online.target

[Service]
Type=simple
WorkingDirectory=/opt/vd-store/apps/api
EnvironmentFile=/opt/vd-store/.env
ExecStart=/usr/bin/node /opt/vd-store/apps/api/dist/main.js
Restart=always
RestartSec=5
TimeoutStopSec=30
NoNewPrivileges=true

[Install]
WantedBy=multi-user.target
```

Tạo Bot service `/etc/systemd/system/vd-store-bot.service`:

```ini
[Unit]
Description=VD Store Telegram Bot
After=network-online.target vd-store-api.service
Wants=network-online.target

[Service]
Type=simple
WorkingDirectory=/opt/vd-store/apps/bot
EnvironmentFile=/opt/vd-store/.env
ExecStart=/usr/bin/node /opt/vd-store/apps/bot/dist/main.js
Restart=always
RestartSec=5
TimeoutStopSec=30
NoNewPrivileges=true

[Install]
WantedBy=multi-user.target
```

Áp dụng và kiểm tra:

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now vd-store-api vd-store-bot
sudo systemctl status vd-store-api vd-store-bot --no-pager
curl http://127.0.0.1:3000/health
curl http://127.0.0.1:3001/health
```

Nếu tổ chức VPS có user chạy service riêng, cấp đúng quyền đọc `/opt/vd-store/.env`, source và `/etc/vd-store`; không dùng user đó để mở PostgreSQL/Redis ra Internet.

## 9. Cấu hình Nginx và SSL

Tạo `/etc/nginx/sites-available/vd-store` (thay domain trước khi lưu):

```nginx
server {
    listen 80;
    listen [::]:80;
    server_name api.<domain>;

    # Broadcast images are capped by the application at 2 MB; leave room for multipart overhead.
    client_max_body_size 3m;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_read_timeout 60s;
    }
}

server {
    listen 80;
    listen [::]:80;
    server_name admin.<domain>;

    root /opt/vd-store/apps/admin/dist;
    index index.html;

    location / {
        try_files $uri $uri/ /index.html;
    }
}

server {
    listen 80;
    listen [::]:80;
    server_name bot.<domain>;

    location / {
        proxy_pass http://127.0.0.1:3001;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

Bật site, kiểm tra cú pháp rồi cấp SSL sau khi DNS đã đúng:

```bash
sudo ln -s /etc/nginx/sites-available/vd-store /etc/nginx/sites-enabled/vd-store
sudo rm -f /etc/nginx/sites-enabled/default
sudo nginx -t
sudo systemctl reload nginx
sudo certbot --nginx -d api.<domain> -d admin.<domain> -d bot.<domain>
sudo systemctl status certbot.timer --no-pager
```

Certbot tự thêm HTTPS redirect và gia hạn. Sau khi xác nhận toàn bộ endpoint hoạt động, có thể thêm HSTS ở Nginx. Không bật HSTS dài hạn trước khi chắc chắn DNS/SSL của mọi subdomain ổn định.

Kiểm tra bên ngoài VPS:

```bash
curl https://api.<domain>/health
curl -I https://admin.<domain>
curl https://bot.<domain>/health
```

## 10. Triển khai storefront lên Vercel

1. Vào Vercel → **Add New → Project** → import repository `vanhub03/vd-store`.
2. Dùng root repository, Framework preset `Vite` hoặc `Other` theo cấu hình dưới đây.
3. Đặt environment variables cho **Production**:

   ```env
   VITE_API_BASE_URL=https://api.<domain>
   VITE_GA_MEASUREMENT_ID=<public-ga-measurement-id-optional>
   ```

4. Cấu hình khuyến nghị khi Root Directory là `./`:

   ```text
   Install Command: corepack enable && corepack prepare pnpm@11.3.0 --activate && pnpm install --frozen-lockfile
   Build Command:   corepack enable && corepack prepare pnpm@11.3.0 --activate && pnpm --filter @vd-store/web build:vercel
   Output Directory: apps/web/dist
   ```

5. Add domain `vanhdao.io.vn` và `www.vanhdao.io.vn` trong Vercel, sau đó tạo chính xác record DNS Vercel hiển thị.
6. Deploy và mở website. Vite prerender catalog/category/product khi build, vì vậy Vercel cần gọi được `VITE_API_BASE_URL`; build chủ ý thất bại nếu API catalog không sẵn sàng để tránh SEO snapshot rỗng.

Không đưa biến backend như `DATABASE_URL`, token Telegram, SePay, Cryptomus hoặc partner key lên Vercel. Các biến bắt đầu `VITE_` được biên dịch vào JavaScript public.

Sau khi cập nhật nhiều sản phẩm/danh mục, deploy lại Vercel để sitemap và các trang SEO tĩnh được làm mới. Sau đó submit `https://www.<domain>/sitemap.xml` trong Google Search Console.

## 11. CI/CD GitHub Actions cho VPS

Workflow [`.github/workflows/deploy-vps.yml`](../.github/workflows/deploy-vps.yml) chạy khi push vào `main` hoặc khi bấm **Run workflow**. Nó chỉ triển khai API, Bot và Admin lên VPS; không điều khiển Vercel.

Trong GitHub repository → **Settings → Secrets and variables → Actions**, tạo:

```text
VPS_HOST=<vps-ip-or-hostname>
VPS_USER=<ssh-deploy-user>
VPS_PORT=22
VPS_SSH_KEY=<private-key-matching-authorized-public-key>
```

Public key tương ứng phải nằm trong `~/.ssh/authorized_keys` của `VPS_USER`. Key private có thể là ed25519 và không dùng passphrase vì GitHub Actions không thể nhập tương tác.

Khi deploy, workflow sẽ:

1. Đóng gói source, loại `.env`, `.git`, `node_modules` và `dist`.
2. Upload archive qua SSH vào VPS.
3. Build release mới trong `/opt/vd-store-next`.
4. Sao chép `.env` persistent sang release mới, chạy install, Prisma generate/migration/seed, build API/Bot/Admin.
5. Đổi thư mục `/opt/vd-store` sang release mới, restart API; Bot chỉ restart nếu nó active trước deploy.
6. Kiểm tra/reload Nginx và giữ tối đa ba release cũ `/opt/vd-store-prev-*`.

Trước push release có thay đổi database hoặc payment, phải chạy backup và test trên staging/local. Docs-only push vẫn kích hoạt workflow này, nên chỉ push sau khi đã xem kỹ diff.

Quy trình deploy bình thường:

```bash
git status
pnpm test
git add <files-da-kiem-tra>
git commit -m "<mo-ta-thay-doi>"
git push origin main
```

Theo dõi Actions đến khi job `Deploy API, bot, and admin to VPS` thành công. Nếu secret VPS chưa cấu hình, workflow thông báo skip thay vì deploy.

## 12. Backup và khôi phục PostgreSQL

Script `scripts/backup-postgres-vps.sh` tạo custom dump, xác minh bằng `pg_restore --list` và mặc định giữ 14 ngày. Tạo service `/etc/systemd/system/vd-store-postgres-backup.service`:

```ini
[Unit]
Description=VD Store PostgreSQL backup
After=postgresql.service

[Service]
Type=oneshot
Environment=VD_STORE_BACKUP_DIR=/var/backups/vd-store-postgres
Environment=VD_STORE_DATABASE=vdstore
Environment=VD_STORE_BACKUP_RETENTION_DAYS=14
ExecStart=/opt/vd-store/scripts/backup-postgres-vps.sh
```

Tạo timer `/etc/systemd/system/vd-store-postgres-backup.timer`:

```ini
[Unit]
Description=Daily VD Store PostgreSQL backup

[Timer]
OnCalendar=*-*-* 03:17:00
Persistent=true

[Install]
WantedBy=timers.target
```

Kích hoạt và chạy thử một lần:

```bash
sudo chmod 755 /opt/vd-store/scripts/backup-postgres-vps.sh
sudo systemctl daemon-reload
sudo systemctl enable --now vd-store-postgres-backup.timer
sudo systemctl start vd-store-postgres-backup.service
sudo systemctl list-timers vd-store-postgres-backup.timer
sudo ls -lh /var/backups/vd-store-postgres
```

Mỗi tháng, kiểm thử restore vào database tạm thay vì đợi sự cố:

```bash
BACKUP=$(sudo find /var/backups/vd-store-postgres -name 'vdstore-*.dump' -type f | sort | tail -n 1)
sudo -u postgres createdb vdstore_restore_check
sudo -u postgres pg_restore --clean --if-exists --no-owner -d vdstore_restore_check "$BACKUP"
sudo -u postgres psql -d vdstore_restore_check -c 'SELECT count(*) FROM "TelegramUser";'
sudo -u postgres dropdb vdstore_restore_check
```

Khôi phục database thật là thao tác phá huỷ dữ liệu mới hơn bản backup. Chỉ làm trong incident đã quyết định phục hồi: dừng API/Bot, chụp backup database hiện tại, restore, chạy migration cần thiết rồi test kỹ. Không chạy lệnh `dropdb` production theo tài liệu này khi chưa xác định đúng thời điểm backup và tác động mất dữ liệu.

## 13. Kiểm thử nghiệm thu sau deploy

Từ máy có source code, chạy smoke suite:

```bash
cd <repo>
pnpm smoke:prod
```

Suite kiểm tra storefront, Admin HTML, API health, catalog, guard auth, Partner OpenAPI, webhook SePay unsigned bị từ chối và marker CSS. Kiểm tra bổ sung trên VPS:

```bash
curl https://api.<domain>/health
curl -I https://admin.<domain>
curl https://bot.<domain>/health
sudo systemctl is-active vd-store-api vd-store-bot postgresql redis-server nginx
sudo journalctl -u vd-store-api -n 100 --no-pager
sudo journalctl -u vd-store-bot -n 100 --no-pager
```

Checklist nghiệp vụ trước khi mở bán:

- Đăng nhập Admin bằng email/password production; đổi/kiểm tra mật khẩu Admin.
- Tạo một sản phẩm `STOCK_ITEM`, kiểm tra tồn, đặt đơn ví thử và xác nhận giao đúng một item.
- Tạo một đơn `MANUAL`, xác nhận alert Telegram Admin, hoàn tất trên Admin và kiểm tra giao hàng.
- Tạo QR nạp tiền nhỏ, chuyển đúng nội dung/mã; xác nhận webhook SePay chỉ cộng một lần.
- Tạo một lệnh USDT nhỏ nếu tính năng bật; xác nhận callback signed và snapshot tỷ giá.
- Gửi `/start` cho Telegram Bot, kiểm tra bot phản hồi; xác nhận service restart tự động sau `systemctl restart vd-store-bot`.
- Vào Partner API bằng key `vd_test_...`; xác nhận đơn test có `livemode: false`, không ảnh hưởng kho/ví/hàng thật. Chỉ sau đó test CTV live có kiểm soát.
- Mở `https://api.<domain>/partner/docs`; kiểm tra key không xuất hiện ở Admin screenshot/log/browser code.
- Vào website mobile/desktop, thử category, product, giỏ hàng, lịch sử giao dịch và ảnh sản phẩm.

Không chạy smoke Partner có tạo data live trên production trừ khi đã đọc script, dùng CTV test riêng và có kế hoạch xoá dữ liệu test.

## 14. Partner API và CTV

Partner API là server-to-server:

```text
Base URL:     https://api.<domain>/partner/v1
OpenAPI UI:   https://api.<domain>/partner/docs
OpenAPI JSON: https://api.<domain>/partner/openapi.json
```

Redis là bắt buộc trên production vì API cần rate limit, giới hạn đồng thời và idempotency cho việc tạo đơn. Key `vd_test_...` chỉ tạo sandbox: không trừ ví, không tiêu kho, không lấy hàng `STOCK_ITEM`, không tiêu voucher và không tạo doanh thu live. Key `vd_live_...` mới được phép tạo đơn thật.

Khi cấp key CTV:

1. Tạo CTV, bật Partner API và tạo key test trước.
2. Chọn đúng scope tối thiểu: `catalog:read`, `balance:read`, `orders:read`, `orders:write`.
3. CTV hoàn tất test webhook/idempotency/sandbox rồi mới cấp key live.
4. CTV phải kiểm `livemode === true` trước khi giao hàng thật cho khách của họ.
5. Key chỉ hiện một lần; yêu cầu CTV lưu trong backend secret manager, không phải frontend/browser.
6. Nếu nghi lộ key, revoke/rotate ngay trên Admin; key cũ mất hiệu lực tức thì.

Tài liệu gửi CTV có sẵn tại [hướng dẫn tích hợp Partner API](./huong-dan-tich-hop-api-ctv.md) và [tham chiếu API](./partner-api.md). Webhook CTV phải là HTTPS public, xác thực chữ ký HMAC, lưu `VD-Event-Id` chống xử lý trùng, trả `2xx` nhanh và xử lý bất đồng bộ.

## 15. Vận hành thường ngày

### Xem tình trạng

```bash
sudo systemctl status vd-store-api vd-store-bot postgresql redis-server nginx --no-pager
sudo journalctl -u vd-store-api -f
sudo journalctl -u vd-store-bot -f
df -h
free -h
redis-cli INFO memory
```

Không paste log thô có token, API key, delivery content hoặc PII vào ticket/chat công khai. Dùng `requestId` trong response Partner API để đối chiếu log nội bộ.

### Thay đổi biến môi trường

1. Backup file `/opt/vd-store/.env` ở nơi mã hoá/được kiểm soát quyền.
2. Sửa trực tiếp file bằng `sudoedit /opt/vd-store/.env`.
3. Kiểm tra không có placeholder/space sai và quyền vẫn là `600`.
4. Restart đúng service: API cho payment/CTV/alert; Bot cho token/chế độ Bot.
5. Chạy một test hẹp, ví dụ `/health`, nạp thử hoặc `/start`.

```bash
sudo chmod 600 /opt/vd-store/.env
sudo systemctl restart vd-store-api
sudo systemctl restart vd-store-bot
sudo systemctl status vd-store-api vd-store-bot --no-pager
```

### Cập nhật code thủ công khi CI tạm lỗi

Ưu tiên GitHub Actions. Chỉ dùng manual deploy trong maintenance window:

```bash
cd /opt/vd-store
git fetch origin
git status
git pull --ff-only origin main
pnpm install --frozen-lockfile
cp .env apps/api/.env
cp .env apps/bot/.env
pnpm prisma:generate
pnpm --filter @vd-store/api exec prisma migrate deploy
pnpm --filter @vd-store/api prisma:seed
pnpm --filter @vd-store/api build
pnpm --filter @vd-store/bot build
VITE_API_BASE_URL=https://api.<domain> pnpm --filter @vd-store/admin build
sudo systemctl restart vd-store-api vd-store-bot
sudo nginx -t && sudo systemctl reload nginx
```

Chỉ chạy `git pull --ff-only` nếu `/opt/vd-store` không có chỉnh sửa local. File `.env` phải nằm ngoài commit; nếu Git báo local change, dừng lại và kiểm tra thay vì dùng `reset --hard`.

## 16. Sự cố thường gặp và rollback

| Hiện tượng | Kiểm tra trước | Cách xử lý an toàn |
|---|---|---|
| Website mở nhưng không tải sản phẩm | `curl https://api.<domain>/health`, browser Network | Kiểm tra API/Redis/PostgreSQL, `VITE_API_BASE_URL`, CORS và Nginx API |
| Admin 502 | `systemctl status vd-store-api`, `nginx -t` | Đọc journal API, kiểm tra port 3000/listen local, restart API sau khi sửa nguyên nhân |
| Bot không phản hồi | `systemctl status vd-store-bot`, logs | Kiểm tra token, chỉ có một instance, `TELEGRAM_BOT_MODE`, DNS/SSL nếu webhook |
| Tiền ngân hàng đã vào nhưng ví chưa cộng | journal API, SePay delivery | Xác nhận webhook đúng `api` URL, HMAC/secret, số tài khoản, giao dịch vào và mã thanh toán; không cộng lặp thủ công trước đối soát |
| CTV báo đơn trùng | Partner order/log theo `requestId` | Kiểm tra `Idempotency-Key`, `externalOrderId`, event ID; không retry bằng key khác khi request cũ chưa rõ trạng thái |
| Vercel build fail khi prerender | Log Vercel, API catalog | Khôi phục API availability/`VITE_API_BASE_URL`; không bypass để deploy catalog SEO rỗng |
| Disk đầy | `df -h`, backup/release dirs, journal | Xoá artifact/log cũ có kiểm soát, giữ backup hợp lệ; không xoá `/var/lib/postgresql` |

### Rollback code release VPS

Workflow giữ các thư mục `/opt/vd-store-prev-*`. Rollback code chỉ phù hợp khi migration mới vẫn tương thích với code cũ. Nếu migration thay đổi dữ liệu/schema không tương thích, cần kế hoạch restore database từ backup.

Trong maintenance window, xác định chính xác release trước rồi chuyển lại:

```bash
sudo systemctl stop vd-store-api vd-store-bot
sudo ls -ld /opt/vd-store-prev-*
# Chọn đúng thư mục <previous-release>; không copy/paste lệnh mv khi chưa kiểm tra tên.
sudo mv /opt/vd-store /opt/vd-store-failed-<timestamp>
sudo mv /opt/vd-store-prev-<timestamp> /opt/vd-store
sudo systemctl start vd-store-api vd-store-bot
sudo nginx -t && sudo systemctl reload nginx
```

Sau rollback, chạy health checks, login Admin, đơn test an toàn và ghi lại thời điểm/cause. Không xoá thư mục failed hoặc backup database trước khi điều tra xong.

## 17. Checklist bảo mật định kỳ

- [ ] Không có secret trong Git (`git grep` chỉ được trả placeholder/mẫu).
- [ ] `.env` và service account JSON có quyền `600`; thư mục secret `700`.
- [ ] SSH chỉ cho phép key, UFW chỉ mở 22/80/443.
- [ ] PostgreSQL/Redis chỉ local; không có dashboard database public.
- [ ] HTTPS/Certbot còn hiệu lực: `sudo certbot renew --dry-run`.
- [ ] Backup hằng ngày thành công và restore thử định kỳ.
- [ ] Có ít nhất một tài khoản Admin dự phòng, mật khẩu được lưu an toàn.
- [ ] Rotate token khi nghi lộ: Telegram, SePay, Cryptomus, JWT, Partner key/webhook secret.
- [ ] Key CTV test/live tách riêng, scope tối thiểu, expiry và revoke key không dùng.
- [ ] Audit log của đổi key/webhook/tỷ giá, giao/hủy đơn được kiểm tra khi có khiếu nại.
- [ ] Sau thay đổi lớn: chạy `pnpm test`, `pnpm smoke:prod`, thanh toán test nhỏ và kiểm tra service logs.

## 18. Tài liệu liên quan

- [Deploy VPS rút gọn](./deploy-vps.md)
- [Deploy storefront trên Vercel](./deploy-web-vercel.md)
- [Runbook migration PostgreSQL](./postgres-migration-runbook.md)
- [Hướng dẫn tích hợp Partner API cho CTV](./huong-dan-tich-hop-api-ctv.md)
- [Tham chiếu Partner API](./partner-api.md)

Khi thay đổi hạ tầng, domain, provider thanh toán hay cách deploy, cập nhật tài liệu này cùng code trong cùng một pull request/commit để người vận hành luôn có một nguồn hướng dẫn chính xác.
