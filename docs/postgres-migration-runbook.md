# PostgreSQL Migration Runbook

This runbook moves production data into the Prisma/PostgreSQL schema with a short write freeze. It is designed for the current VD Store API, bot, web checkout, wallet, voucher, collaborator, admin, and audit flows.

## 1. Preflight

1. Identify the live source of truth: current `DATABASE_URL`, legacy DB, or exported JSON.
2. Take a full backup of the source system and keep it read-only until the new PostgreSQL has run cleanly for 24-48 hours.
3. Provision PostgreSQL with a pooled runtime URL for API traffic and a direct URL for migrations/imports when the provider requires it.
4. Run schema migration on staging:

```bash
pnpm --filter @vd-store/api exec prisma migrate deploy
pnpm --filter @vd-store/api prisma:generate
```

## 2. Snapshot And Import

Create a baseline snapshot before import:

```bash
pnpm --filter @vd-store/api migration:discover
pnpm --filter @vd-store/api migration:snapshot ./migration-before.json
```

If the source is a JSON export, use model-name arrays such as `TelegramUser`, `Product`, `Order`, and `Payment`, then import:

```bash
pnpm --filter @vd-store/api migration:import ./source-export.json
pnpm --filter @vd-store/api migration:snapshot ./migration-after.json
pnpm --filter @vd-store/api migration:reconcile ./migration-before.json ./migration-reconcile.json
```

If the source is already PostgreSQL, prefer `pg_dump`/`pg_restore` into staging, then run `migration:reconcile`.

## 3. Cutover Window

Target downtime is 5-15 minutes.

1. Enable maintenance mode or stop write entrypoints: checkout, wallet top-up, voucher changes, product CRUD, inventory import.
2. Export the final delta from the source.
3. Import the delta into PostgreSQL.
4. Run reconcile and confirm there are no orphan records or critical total mismatches.
5. Point production services to the new `DATABASE_URL`.
6. Run:

```bash
pnpm --filter @vd-store/api exec prisma migrate deploy
pnpm --filter @vd-store/api prisma:generate
pnpm build
pnpm test
```

7. Restart API, bot, admin, and web services.
8. Run smoke tests: login reload, catalog, cart checkout all, VietQR, wallet, USDT, voucher, admin CRUD.

## 4. Rollback

Rollback if login/session, checkout/payment, admin CRUD, or webhook smoke tests fail.

1. Repoint services to the old source.
2. Restart API, bot, admin, and web.
3. Keep the failed PostgreSQL target untouched for debugging.
4. Do not delete old data until production has run cleanly for 24-48 hours.

## 5. Performance Acceptance

- Catalog/home API should respond from cache in roughly 300-500ms or faster under normal load.
- Checkout/payment creation should stay around 1-2s excluding external provider latency.
- Admin list endpoints must be bounded by pagination/limits and should not scan unbounded tables.
- Run `EXPLAIN ANALYZE` for slow catalog, order, payment, voucher, and dashboard queries before adding more indexes.
