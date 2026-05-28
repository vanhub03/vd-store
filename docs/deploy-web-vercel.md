# Deploy storefront on Vercel Free

Use this when Render has no free custom-domain slot left. Keep these services on Render:

- `api.vanhdao.io.vn` for API and SePay webhook
- `admin.vanhdao.io.vn` for admin dashboard
- `vd-store-bot.onrender.com` for Telegram bot webhook

Deploy only the public storefront to Vercel and point `vanhdao.io.vn` there.

## Steps

1. Go to Vercel > Add New > Project.
2. Import GitHub repo `vanhub03/vd-store`.
3. Use the repo root. The root `vercel.json` already tells Vercel to build `apps/web` and copy the output to root `dist`.
4. Add environment variable:

   ```env
   VITE_API_BASE_URL=https://api.vanhdao.io.vn
   ```

5. Deploy.
   If you already created the project and Vercel still says `No Output Directory named "dist"`, go to Settings > Build and Development Settings and use one of these two configurations.

   Recommended for this repo:

   ```text
   Root Directory: ./
   Framework Preset: Other
   Build Command: corepack enable && corepack prepare pnpm@11.3.0 --activate && pnpm install --frozen-lockfile && pnpm --filter @vd-store/web build:vercel
   Output Directory: dist
   Install Command: corepack enable && corepack prepare pnpm@11.3.0 --activate && pnpm install --frozen-lockfile
   ```

   If your Vercel project is already locked to `apps/web` as Root Directory, use:

   ```text
   Root Directory: apps/web
   Framework Preset: Vite
   Build Command: corepack enable && corepack prepare pnpm@11.3.0 --activate && pnpm build
   Output Directory: dist
   Install Command: corepack enable && corepack prepare pnpm@11.3.0 --activate && pnpm install --frozen-lockfile
   ```
6. In Vercel project > Settings > Domains, add:

   ```text
   vanhdao.io.vn
   www.vanhdao.io.vn
   ```

7. In Nhan Hoa DNS, point the domain using the exact records Vercel shows. Usually:

   ```text
   Type: A
   Host: @
   Value: 76.76.21.21
   TTL: 300
   ```

   ```text
   Type: CNAME
   Host: www
   Value: cname.vercel-dns.com
   TTL: 300
   ```

8. Wait for DNS propagation, then click Verify in Vercel.

The storefront calls the existing Render API, so SePay, wallet, products, and orders continue using the current backend.
