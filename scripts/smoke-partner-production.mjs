import crypto from "node:crypto";
import { PrismaClient } from "@prisma/client";

const apiUrl = process.env.SMOKE_API_URL ?? "https://api.vanhdao.io.vn";
const adminEmail = process.env.ADMIN_EMAIL;
const adminPassword = process.env.ADMIN_PASSWORD;
if (!adminEmail || !adminPassword) throw new Error("ADMIN_EMAIL and ADMIN_PASSWORD are required for the authenticated Partner API smoke test.");

const prisma = new PrismaClient();
const runId = crypto.randomUUID().replace(/-/g, "");
const collaboratorEmail = `partner-smoke-${runId}@example.invalid`;
const collaboratorPassword = `Smoke-${crypto.randomBytes(18).toString("base64url")}`;
let collaboratorId;

try {
  const session = await request("POST", "/auth/login", { email: adminEmail, password: adminPassword });
  const adminHeaders = { authorization: `Bearer ${session.token}` };
  const collaborator = await request("POST", "/admin/collaborators", {
    email: collaboratorEmail,
    displayName: "Partner Production Smoke",
    password: collaboratorPassword
  }, adminHeaders);
  collaboratorId = collaborator.id;
  await request("PUT", `/admin/collaborators/${collaboratorId}/api-settings`, { enabled: true, readRateLimit: 120, writeRateLimit: 20 }, adminHeaders);

  const keyResult = await request("POST", `/admin/collaborators/${collaboratorId}/api-keys`, {
    environment: "TEST",
    label: "Production smoke",
    scopes: ["catalog:read", "balance:read", "orders:read", "orders:write"],
    expiresInDays: 1
  }, adminHeaders);
  const partnerHeaders = { authorization: `Bearer ${keyResult.secret}` };
  const catalog = await request("GET", "/partner/v1/catalog", undefined, partnerHeaders);
  const products = [...catalog.categories.flatMap((category) => category.products ?? []), ...(catalog.uncategorized ?? [])];
  if (!products.length) throw new Error("Partner catalog is empty.");
  const product = products.find((item) => item.deliveryType !== "MANUAL") ?? products[0];
  const externalOrderId = `production-smoke-${runId}`;
  const orderHeaders = { ...partnerHeaders, "idempotency-key": externalOrderId };
  const body = { externalOrderId, items: [{ productId: product.id, quantity: 1 }] };
  const order = await request("POST", "/partner/v1/orders", body, orderHeaders);
  const replay = await request("POST", "/partner/v1/orders", body, orderHeaders);
  if (order.id !== replay.id) throw new Error("Idempotency replay returned a different order.");
  const fetched = await request("GET", `/partner/v1/orders/${order.id}`, undefined, partnerHeaders);
  if (fetched.id !== order.id || fetched.livemode !== false) throw new Error("Sandbox order retrieval failed.");

  const conflict = await rawRequest("POST", "/partner/v1/orders", { ...body, externalOrderId: `${externalOrderId}-different` }, orderHeaders);
  if (conflict.status !== 409) throw new Error(`Expected idempotency conflict 409, received ${conflict.status}.`);
  const browserProbe = await rawRequest("GET", "/partner/v1/catalog", undefined, { ...partnerHeaders, origin: "https://example.invalid" });
  if (browserProbe.status !== 403) throw new Error(`Expected browser Origin rejection 403, received ${browserProbe.status}.`);

  await request("DELETE", `/admin/collaborators/${collaboratorId}/api-keys/${keyResult.credential.id}`, undefined, adminHeaders);
  const revokedProbe = await rawRequest("GET", "/partner/v1/catalog", undefined, partnerHeaders);
  if (revokedProbe.status !== 401) throw new Error(`Expected revoked key rejection 401, received ${revokedProbe.status}.`);

  console.log(`PASS authenticated Partner API production smoke: ${products.length} product(s), sandbox order ${order.status}, idempotency/revoke/browser guards verified.`);
} finally {
  if (collaboratorId) await prisma.telegramUser.deleteMany({ where: { id: collaboratorId, email: collaboratorEmail } });
  await prisma.$disconnect();
}

async function request(method, path, body, headers = {}) {
  const response = await rawRequest(method, path, body, headers);
  const payload = await response.json().catch(() => null);
  if (!response.ok) throw new Error(`${method} ${path} failed with HTTP ${response.status}: ${payload?.code ?? payload?.message ?? "unknown error"}`);
  return payload;
}

function rawRequest(method, path, body, headers = {}) {
  return fetch(`${apiUrl}${path}`, {
    method,
    headers: { ...headers, ...(body === undefined ? {} : { "content-type": "application/json" }) },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(30_000)
  });
}
