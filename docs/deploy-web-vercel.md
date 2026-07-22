# Deploy storefront on Vercel

The public storefront runs on Vercel. API, admin, Telegram bot, PostgreSQL, and Redis run on the production VPS:

- `api.vanhdao.io.vn` for API and SePay webhook
- `admin.vanhdao.io.vn` for admin dashboard
- `bot.vanhdao.io.vn` for Telegram bot webhook

Deploy only the public storefront to Vercel and point `vanhdao.io.vn` there.

## Steps

1. Go to Vercel > Add New > Project.
2. Import GitHub repo `vanhub03/vd-store`.
3. Use the repo root. The root `vercel.json` already tells Vercel to build `apps/web` and copy the output to root `dist`.
4. Add environment variable:

   ```env
   VITE_API_BASE_URL=https://api.vanhdao.io.vn
   VITE_GA_MEASUREMENT_ID=G-CFYXXY4CYJ
   ```

   The production build fetches the public catalog from this API to prerender
   `/san-pham`, `/danh-gia`, every `/danh-muc/...` page, every
   `/san-pham/...` page, and `sitemap.xml`. If the catalog API is unavailable,
   the build intentionally fails instead of deploying an empty SEO snapshot.

   The measurement ID is also compiled as a safe fallback because it is a public
   website identifier, but keeping it in Vercel makes future property changes
   explicit.

5. Deploy.
   If you already created the project and Vercel still says `No Output Directory named "dist"`, go to Settings > Build and Development Settings and use one of these two configurations.

   Recommended if Vercel Root Directory is the repo root:

   ```text
   Root Directory: ./
   Framework Preset: Other
   Build Command: corepack enable && corepack prepare pnpm@11.3.0 --activate && pnpm install --frozen-lockfile && pnpm --filter @vd-store/web build:vercel
   Output Directory: apps/web/dist
   Install Command: corepack enable && corepack prepare pnpm@11.3.0 --activate && pnpm install --frozen-lockfile
   ```

   If your Vercel project is already locked to `apps/web` as Root Directory, use:

   ```text
   Root Directory: apps/web
   Framework Preset: Vite
   Build Command: corepack enable && corepack prepare pnpm@11.3.0 --activate && pnpm build:vercel
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

The storefront calls the VPS API, so SePay, wallet, products, and orders use the same PostgreSQL database as admin and the Telegram bot.

## Search Console after deployment

1. Submit `https://www.vanhdao.io.vn/sitemap.xml` in Search Console.
2. Inspect `/`, `/san-pham`, `/danh-gia`, one category URL, and one product URL.
3. Request indexing for those sample URLs. Google will discover the remaining
   category and product pages from the sitemap.
4. Old `/?tab=products`, `/?tab=reviews`, and `/?category=...` links are
   converted to the corresponding clean URL by the storefront and are not
   included in the sitemap.

The sitemap and prerendered product pages are refreshed on every storefront
deployment. After a large catalog change, redeploy the Vercel storefront so the
SEO snapshot reflects the latest catalog.
