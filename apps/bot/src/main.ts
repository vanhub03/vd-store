import express from "express";
import { Context, Markup, Telegraf } from "telegraf";
import { ApiClient, CatalogResponse, HistoryResponse, PaymentResponse, ProductDetail, WalletPurchaseResponse } from "./api";
import { escapeHtml, formatVnd, productStockLabel } from "./format";

const token = process.env.TELEGRAM_BOT_TOKEN;
if (!token) {
  throw new Error("TELEGRAM_BOT_TOKEN is required for @vd-store/bot.");
}

const api = new ApiClient();
const bot = new Telegraf(token);

function mainKeyboard() {
  return Markup.inlineKeyboard([
    [Markup.button.callback("Sản phẩm", "catalog"), Markup.button.callback("Số dư", "wallet")],
    [Markup.button.callback("Nạp tiền", "topup"), Markup.button.callback("Lịch sử", "history")],
    [Markup.button.callback("Hỗ trợ", "support")]
  ]);
}

async function upsertUser(ctx: Context) {
  if (!ctx.from) return;
  await api.post("/bot/users/upsert", {
    telegramId: String(ctx.from.id),
    username: ctx.from.username,
    firstName: ctx.from.first_name,
    lastName: ctx.from.last_name,
    languageCode: ctx.from.language_code
  });
}

bot.start(async (ctx) => {
  await upsertUser(ctx);
  await ctx.reply(
    "Chào bạn. Đây là bot bán hàng tự động.\nBạn có thể xem sản phẩm, nạp tiền, mua hàng và kiểm tra lịch sử ngay trong bot.",
    mainKeyboard()
  );
});

bot.action("catalog", async (ctx) => {
  await ctx.answerCbQuery();
  await showCatalog(ctx);
});

bot.action(/^cat:(.+)$/, async (ctx) => {
  await ctx.answerCbQuery();
  await showCatalog(ctx);
});

bot.action(/^prod:(.+)$/, async (ctx) => {
  await ctx.answerCbQuery();
  await showProduct(ctx, ctx.match[1]);
});

bot.action("wallet", async (ctx) => {
  await ctx.answerCbQuery();
  await upsertUser(ctx);
  const wallet = await api.get<{ balance: number }>(`/bot/wallet/${ctx.from!.id}`);
  await ctx.reply(`Số dư hiện tại: ${formatVnd(wallet.balance)}`, mainKeyboard());
});

bot.action("topup", async (ctx) => {
  await ctx.answerCbQuery();
  await upsertUser(ctx);
  await ctx.reply(
    "Chọn số tiền cần nạp. QR có hiệu lực trong 10 phút.",
    Markup.inlineKeyboard([
      [Markup.button.callback("50.000đ", "topup:50000"), Markup.button.callback("100.000đ", "topup:100000")],
      [Markup.button.callback("200.000đ", "topup:200000"), Markup.button.callback("500.000đ", "topup:500000")],
      [Markup.button.callback("Quay lại", "home")]
    ])
  );
});

bot.action(/^topup:(\d+)$/, async (ctx) => {
  await ctx.answerCbQuery();
  await upsertUser(ctx);
  const amount = Number(ctx.match[1]);
  const result = await api.post<PaymentResponse>("/bot/topups", {
    telegramId: String(ctx.from!.id),
    amount
  });
  await sendQr(ctx, result.payment.id, result.qrImageUrl, buildQrCaption("Nạp tiền", result.code, amount, result.expiresAt));
});

bot.action(/^buy_wallet:(.+)$/, async (ctx) => {
  await ctx.answerCbQuery();
  await upsertUser(ctx);
  const result = await api.post<WalletPurchaseResponse>("/bot/orders/wallet", {
    telegramId: String(ctx.from!.id),
    productId: ctx.match[1],
    quantity: 1
  });
  await ctx.reply(`Mua hàng thành công.\nSố dư còn lại: ${formatVnd(result.balanceAfter)}\n\nHàng của bạn:\n<pre>${escapeHtml(result.deliveryText)}</pre>`, {
    parse_mode: "HTML",
    ...mainKeyboard()
  });
});

bot.action(/^buy_bank:(.+)$/, async (ctx) => {
  await ctx.answerCbQuery();
  await upsertUser(ctx);
  const result = await api.post<PaymentResponse>("/bot/orders/bank", {
    telegramId: String(ctx.from!.id),
    productId: ctx.match[1],
    quantity: 1
  });
  await sendQr(ctx, result.payment.id, result.qrImageUrl, buildQrCaption("Mua hàng", result.code, result.amount, result.expiresAt));
});

bot.action("history", async (ctx) => {
  await ctx.answerCbQuery();
  await upsertUser(ctx);
  const history = await api.get<HistoryResponse>(`/bot/history/${ctx.from!.id}`);
  const orderLines = history.orders.length
    ? history.orders.map((order) => `${order.code} - ${order.product.name} - ${formatVnd(order.totalAmount)} - ${order.status}`).join("\n")
    : "Chưa có đơn hàng.";
  const ledgerLines = history.ledger.length
    ? history.ledger.map((entry) => `${formatVnd(entry.amount)} - ${entry.type}${entry.note ? ` - ${entry.note}` : ""}`).join("\n")
    : "Chưa có giao dịch ví.";
  await ctx.reply(`Đơn hàng gần đây:\n${orderLines}\n\nGiao dịch ví gần đây:\n${ledgerLines}`, mainKeyboard());
});

bot.action("support", async (ctx) => {
  await ctx.answerCbQuery();
  await ctx.reply(`Vui lòng liên hệ admin @${process.env.ADMIN_TELEGRAM_USERNAME ?? "vanhdao99"} để được hỗ trợ.`, mainKeyboard());
});

bot.action("home", async (ctx) => {
  await ctx.answerCbQuery();
  await ctx.reply("Menu chính", mainKeyboard());
});

bot.catch(async (error, ctx) => {
  console.error(error);
  await ctx.reply(`Có lỗi xảy ra: ${(error as Error).message}`, mainKeyboard()).catch(() => undefined);
});

async function showCatalog(ctx: Context) {
  await upsertUser(ctx);
  const catalog = await api.get<CatalogResponse>("/bot/catalog");
  const products = flattenProducts(catalog);
  const buttons = products.slice(0, 40).map((product) => [
    Markup.button.callback(`${product.name} - ${formatVnd(product.price)}`, `prod:${product.id}`)
  ]);
  buttons.push([Markup.button.callback("Quay lại", "home")]);
  await ctx.reply(products.length ? "Chọn sản phẩm:" : "Hiện chưa có sản phẩm đang bán.", Markup.inlineKeyboard(buttons));
}

async function showProduct(ctx: Context, productId: string) {
  const product = await api.get<ProductDetail>(`/bot/products/${productId}`);
  const description = product.description ? `\n${product.description}` : "";
  const categoryLine = product.category?.name ? `Danh mục: <b>${escapeHtml(product.category.name)}</b>\n` : "";
  await ctx.reply(
    `${categoryLine}<b>${escapeHtml(product.name)}</b>${escapeHtml(description)}\nGiá: <b>${formatVnd(product.price)}</b>\n${productStockLabel(product)}`,
    {
      parse_mode: "HTML",
      ...Markup.inlineKeyboard([
        [Markup.button.callback("Mua bằng ví", `buy_wallet:${product.id}`)],
        [Markup.button.callback("Chuyển khoản QR", `buy_bank:${product.id}`)],
        [Markup.button.callback("Quay lại", "catalog")]
      ])
    }
  );
}

async function sendQr(ctx: Context, paymentId: string, qrImageUrl: string, caption: string) {
  const sent = await sendQrPhotoWithFallback(ctx, qrImageUrl, caption);
  await api.post(`/bot/payments/${paymentId}/telegram-message`, {
    telegramChatId: String(ctx.chat!.id),
    telegramMessageId: sent.message_id
  });
}

async function sendQrPhotoWithFallback(ctx: Context, qrImageUrl: string, caption: string) {
  try {
    const image = await fetch(qrImageUrl);
    if (!image.ok) throw new Error(`VietQR returned HTTP ${image.status}`);
    const contentType = image.headers.get("content-type") ?? "";
    if (!contentType.includes("image")) throw new Error(`VietQR returned ${contentType || "unknown content type"}`);
    const buffer = Buffer.from(await image.arrayBuffer());
    return ctx.replyWithPhoto({ source: buffer, filename: "vietqr.png" }, { caption, parse_mode: "HTML" });
  } catch (error) {
    console.error("Could not upload VietQR image:", error);
    return ctx.reply(`${caption}\n\nLink QR: ${escapeHtml(qrImageUrl)}`, { parse_mode: "HTML" });
  }
}

function buildQrCaption(title: string, code: string, amount: number, expiresAt: string) {
  return `${title}\nSố tiền: <b>${formatVnd(amount)}</b>\nNội dung CK: <code>${code}</code>\nHạn thanh toán: ${new Date(
    expiresAt
  ).toLocaleString("vi-VN")}\nHệ thống sẽ tự xử lý khi nhận tiền.`;
}

function flattenProducts(catalog: CatalogResponse) {
  return [
    ...catalog.categories.flatMap((category) => category.products.map((product) => ({ ...product, category }))),
    ...catalog.uncategorized
  ];
}

async function launch() {
  const mode = process.env.TELEGRAM_BOT_MODE ?? "polling";
  if (mode === "webhook") {
    const publicUrl = process.env.TELEGRAM_WEBHOOK_PUBLIC_URL;
    if (!publicUrl) throw new Error("TELEGRAM_WEBHOOK_PUBLIC_URL is required in webhook mode.");
    const path = process.env.TELEGRAM_WEBHOOK_PATH ?? "/telegram/webhook";
    await bot.telegram.setWebhook(`${publicUrl}${path}`);
    const app = express();
    app.get("/health", (_request, response) => {
      response.json({ ok: true, service: "vd-store-bot", timestamp: new Date().toISOString() });
    });
    app.use(bot.webhookCallback(path));
    const port = Number(process.env.PORT ?? process.env.BOT_PORT ?? 3001);
    app.listen(port, () => console.log(`VD Store bot webhook listening on ${port}${path}`));
    return;
  }

  await bot.launch();
  console.log("VD Store bot started in polling mode.");
}

launch();

process.once("SIGINT", () => bot.stop("SIGINT"));
process.once("SIGTERM", () => bot.stop("SIGTERM"));
