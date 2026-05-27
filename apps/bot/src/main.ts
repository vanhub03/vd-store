import express from "express";
import { Context, Markup, Telegraf } from "telegraf";
import { ExtraEditMessageText, ExtraReplyMessage } from "telegraf/typings/telegram-types";
import {
  ApiClient,
  CatalogResponse,
  HistoryResponse,
  PaymentResponse,
  ProductDetail,
  ProductSummary,
  WalletPurchaseResponse
} from "./api";
import { escapeHtml, formatVnd, productStockLabel } from "./format";

const token = process.env.TELEGRAM_BOT_TOKEN;
if (!token) {
  throw new Error("TELEGRAM_BOT_TOKEN is required for @vd-store/bot.");
}

const api = new ApiClient();
const bot = new Telegraf(token);
const CATALOG_BUTTON_LIMIT = 40;
const CATALOG_TEXT_LIMIT = 25;
const BOT_COMMANDS = [
  { command: "start", description: "Bắt đầu sử dụng bot" },
  { command: "help", description: "Xem cú pháp chat nhanh" },
  { command: "menu", description: "Mở menu chính" },
  { command: "sanpham", description: "Xem tất cả sản phẩm" },
  { command: "xem", description: "Xem sản phẩm: /xem 1" },
  { command: "mua", description: "Mua hàng: /mua 1 vi hoặc /mua 1 ck" },
  { command: "nap", description: "Nạp tiền: /nap 100000" },
  { command: "sodu", description: "Xem số dư ví" },
  { command: "lichsu", description: "Xem lịch sử mua/nạp" },
  { command: "hotro", description: "Liên hệ hỗ trợ" }
];

const HELP_TEXT = [
  "Cú pháp chat nhanh:",
  "/menu - mở menu chính",
  "/sanpham - xem tất cả sản phẩm",
  "/xem 1 - xem sản phẩm theo số thứ tự trong danh sách",
  "/xem ten san pham - tìm sản phẩm theo tên",
  "/mua 1 vi - mua sản phẩm số 1 bằng số dư ví",
  "/mua 1 ck - tạo QR chuyển khoản để mua sản phẩm số 1",
  "/nap 100000 - tạo QR nạp 100.000đ",
  "/sodu - xem số dư ví",
  "/lichsu - xem lịch sử đơn hàng và giao dịch ví",
  "/hotro - liên hệ admin hỗ trợ",
  "",
  "Gửi /sanpham trước để xem số thứ tự sản phẩm."
].join("\n");

function mainKeyboard() {
  return Markup.inlineKeyboard([
    [Markup.button.callback("Sản phẩm", "catalog"), Markup.button.callback("Số dư", "wallet")],
    [Markup.button.callback("Nạp tiền", "topup"), Markup.button.callback("Lịch sử", "history")],
    [Markup.button.callback("Hỗ trợ", "support"), Markup.button.callback("Hướng dẫn", "help")]
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
  await showHome(
    ctx,
    "Chào bạn. Đây là bot bán hàng tự động.\nBạn có thể xem sản phẩm, nạp tiền, mua hàng và kiểm tra lịch sử ngay trong bot.\n\nGửi /help để xem cú pháp chat nhanh."
  );
});

bot.command("help", (ctx) => showHelp(ctx));
bot.command("menu", (ctx) => showHome(ctx));
bot.command("sanpham", (ctx) => showCatalog(ctx));
bot.command("xem", (ctx) => showProductByCommand(ctx));
bot.command("mua", (ctx) => purchaseByCommand(ctx));
bot.command("nap", (ctx) => topupByCommand(ctx));
bot.command("sodu", (ctx) => showWallet(ctx));
bot.command("lichsu", (ctx) => showHistory(ctx));
bot.command("hotro", (ctx) => showSupport(ctx));

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
  await showWallet(ctx);
});

bot.action("topup", async (ctx) => {
  await ctx.answerCbQuery();
  await showTopup(ctx);
});

bot.action(/^topup:(\d+)$/, async (ctx) => {
  await ctx.answerCbQuery();
  await createTopupQr(ctx, Number(ctx.match[1]));
});

bot.action(/^buy_wallet:(.+)$/, async (ctx) => {
  await ctx.answerCbQuery();
  await purchaseWithWallet(ctx, ctx.match[1]);
});

bot.action(/^buy_bank:(.+)$/, async (ctx) => {
  await ctx.answerCbQuery();
  await createBankOrderQr(ctx, ctx.match[1]);
});

bot.action("history", async (ctx) => {
  await ctx.answerCbQuery();
  await showHistory(ctx);
});

bot.action("support", async (ctx) => {
  await ctx.answerCbQuery();
  await showSupport(ctx);
});

bot.action("help", async (ctx) => {
  await ctx.answerCbQuery();
  await showHelp(ctx);
});

bot.action("home", async (ctx) => {
  await ctx.answerCbQuery();
  await showHome(ctx);
});

bot.on("text", async (ctx) => {
  const text = ctx.message.text.trim().toLocaleLowerCase("vi-VN");
  if (text === "help" || text === "tro giup" || text === "trợ giúp") return showHelp(ctx);
  if (text === "menu") return showHome(ctx);
  if (text === "san pham" || text === "sản phẩm") return showCatalog(ctx);
  if (text === "so du" || text === "số dư") return showWallet(ctx);
  if (text === "lich su" || text === "lịch sử") return showHistory(ctx);
  return ctx.reply("Mình chưa hiểu lệnh này. Gửi /help để xem cú pháp chat nhanh.", mainKeyboard());
});

bot.catch(async (error, ctx) => {
  console.error(error);
  await ctx.reply(`Có lỗi xảy ra: ${(error as Error).message}`, mainKeyboard()).catch(() => undefined);
});

async function showCatalog(ctx: Context) {
  await upsertUser(ctx);
  const catalog = await api.get<CatalogResponse>("/bot/catalog");
  const products = flattenProducts(catalog);
  const buttons = products.slice(0, CATALOG_BUTTON_LIMIT).map((product, index) => [
    Markup.button.callback(`${index + 1}. ${product.name} - ${formatVnd(product.price)}`, `prod:${product.id}`)
  ]);
  buttons.push([Markup.button.callback("Quay lại", "home")]);
  await updateText(ctx, buildCatalogText(products), Markup.inlineKeyboard(buttons));
}

async function showWallet(ctx: Context) {
  await upsertUser(ctx);
  const wallet = await api.get<{ balance: number }>(`/bot/wallet/${ctx.from!.id}`);
  await updateText(ctx, `Số dư hiện tại: ${formatVnd(wallet.balance)}`, mainKeyboard());
}

async function showTopup(ctx: Context) {
  await upsertUser(ctx);
  await updateText(
    ctx,
    "Chọn số tiền cần nạp. QR có hiệu lực trong 10 phút.\n\nBạn cũng có thể chat: /nap 100000",
    Markup.inlineKeyboard([
      [Markup.button.callback("50.000đ", "topup:50000"), Markup.button.callback("100.000đ", "topup:100000")],
      [Markup.button.callback("200.000đ", "topup:200000"), Markup.button.callback("500.000đ", "topup:500000")],
      [Markup.button.callback("Quay lại", "home")]
    ])
  );
}

async function showHistory(ctx: Context) {
  await upsertUser(ctx);
  const history = await api.get<HistoryResponse>(`/bot/history/${ctx.from!.id}`);
  const orderLines = history.orders.length
    ? history.orders.map((order) => `${order.code} - ${order.product.name} - ${formatVnd(order.totalAmount)} - ${order.status}`).join("\n")
    : "Chưa có đơn hàng.";
  const ledgerLines = history.ledger.length
    ? history.ledger.map((entry) => `${formatVnd(entry.amount)} - ${entry.type}${entry.note ? ` - ${entry.note}` : ""}`).join("\n")
    : "Chưa có giao dịch ví.";
  await updateText(ctx, `Đơn hàng gần đây:\n${orderLines}\n\nGiao dịch ví gần đây:\n${ledgerLines}`, mainKeyboard());
}

async function showSupport(ctx: Context) {
  await updateText(ctx, `Vui lòng liên hệ admin @${process.env.ADMIN_TELEGRAM_USERNAME ?? "vanhdao99"} để được hỗ trợ.`, mainKeyboard());
}

async function showHelp(ctx: Context) {
  await updateText(ctx, HELP_TEXT, mainKeyboard());
}

async function showHome(ctx: Context, message = "Menu chính\n\nGửi /help để xem cú pháp chat nhanh.") {
  await updateText(ctx, message, mainKeyboard());
}

async function showProduct(ctx: Context, productId: string) {
  const product = await api.get<ProductDetail>(`/bot/products/${productId}`);
  await showProductDetail(ctx, product);
}

async function showProductDetail(ctx: Context, product: ProductDetail) {
  const description = product.description ? `\n${product.description}` : "";
  const categoryLine = product.category?.name ? `Danh mục: <b>${escapeHtml(product.category.name)}</b>\n` : "";
  const caption = `${categoryLine}<b>${escapeHtml(product.name)}</b>${escapeHtml(description)}\nGiá: <b>${formatVnd(product.price)}</b>\n${productStockLabel(
    product
  )}\n\nChat nhanh: /mua ${escapeHtml(product.name)} vi hoặc /mua ${escapeHtml(product.name)} ck`;
  const keyboard = Markup.inlineKeyboard([
    [Markup.button.callback("Mua bằng ví", `buy_wallet:${product.id}`)],
    [Markup.button.callback("Chuyển khoản QR", `buy_bank:${product.id}`)],
    [Markup.button.callback("Quay lại", "catalog")]
  ]);

  if (product.imageUrl) {
    const updated = await updateProductPhoto(ctx, product.imageUrl, caption, keyboard);
    if (updated) return;
  }

  await updateText(ctx, withImageLink(caption, product.imageUrl), {
    parse_mode: "HTML",
    ...keyboard
  });
}

async function updateProductPhoto(ctx: Context, imageUrl: string, caption: string, extra: ExtraReplyMessage) {
  if ("callbackQuery" in ctx.update && ctx.callbackQuery?.message) {
    try {
      await ctx.editMessageMedia(
        {
          type: "photo",
          media: imageUrl,
          caption,
          parse_mode: "HTML"
        },
        extra as never
      );
      return true;
    } catch (error) {
      console.error("Could not edit Telegram product photo:", error);
      return false;
    }
  }

  try {
    await ctx.replyWithPhoto(imageUrl, {
      caption,
      parse_mode: "HTML",
      ...extra
    });
    return true;
  } catch (error) {
    console.error("Could not send Telegram product photo:", error);
    return false;
  }
}

function withImageLink(caption: string, imageUrl?: string | null) {
  return imageUrl ? `${caption}\nLogo: <a href="${escapeHtml(imageUrl)}">xem ảnh</a>` : caption;
}

async function showProductByCommand(ctx: Context) {
  const reference = getCommandArgs(ctx).join(" ").trim();
  if (!reference) return showCatalog(ctx);

  await upsertUser(ctx);
  const product = await findProductByReference(reference);
  if (!product) {
    await ctx.reply(`Không tìm thấy sản phẩm "${reference}". Gửi /sanpham để xem danh sách.`, mainKeyboard());
    return;
  }
  await showProductDetail(ctx, product);
}

async function purchaseByCommand(ctx: Context) {
  const args = getCommandArgs(ctx);
  const parsed = parsePurchaseArgs(args);
  if (!parsed.productReference) {
    await ctx.reply("Thiếu sản phẩm cần mua.\nVí dụ: /mua 1 vi hoặc /mua 1 ck", mainKeyboard());
    return;
  }

  await upsertUser(ctx);
  const product = await findProductByReference(parsed.productReference);
  if (!product) {
    await ctx.reply(`Không tìm thấy sản phẩm "${parsed.productReference}". Gửi /sanpham để xem danh sách.`, mainKeyboard());
    return;
  }

  if (!parsed.method) {
    await showProductDetail(ctx, product);
    return;
  }

  if (parsed.method === "wallet") {
    await purchaseWithWallet(ctx, product.id);
    return;
  }
  await createBankOrderQr(ctx, product.id);
}

async function topupByCommand(ctx: Context) {
  const [amountText] = getCommandArgs(ctx);
  if (!amountText) return showTopup(ctx);

  const amount = parseVndAmount(amountText);
  if (!amount) {
    await ctx.reply("Số tiền nạp không hợp lệ.\nVí dụ: /nap 100000 hoặc /nap 100k", mainKeyboard());
    return;
  }

  await createTopupQr(ctx, amount);
}

async function createTopupQr(ctx: Context, amount: number) {
  await upsertUser(ctx);
  const result = await api.post<PaymentResponse>("/bot/topups", {
    telegramId: String(ctx.from!.id),
    amount
  });
  await sendQr(ctx, result.payment.id, result.qrImageUrl, buildQrCaption("Nạp tiền", result.code, amount, result.expiresAt));
}

async function purchaseWithWallet(ctx: Context, productId: string) {
  await upsertUser(ctx);
  const result = await api.post<WalletPurchaseResponse>("/bot/orders/wallet", {
    telegramId: String(ctx.from!.id),
    productId,
    quantity: 1
  });
  await ctx.reply(`Mua hàng thành công.\nSố dư còn lại: ${formatVnd(result.balanceAfter)}\n\nHàng của bạn:\n<pre>${escapeHtml(result.deliveryText)}</pre>`, {
    parse_mode: "HTML",
    ...mainKeyboard()
  });
}

async function createBankOrderQr(ctx: Context, productId: string) {
  await upsertUser(ctx);
  const result = await api.post<PaymentResponse>("/bot/orders/bank", {
    telegramId: String(ctx.from!.id),
    productId,
    quantity: 1
  });
  await sendQr(ctx, result.payment.id, result.qrImageUrl, buildQrCaption("Mua hàng", result.code, result.amount, result.expiresAt));
}

async function updateText(ctx: Context, text: string, extra?: ExtraReplyMessage) {
  if ("callbackQuery" in ctx.update && ctx.callbackQuery?.message) {
    try {
      await ctx.editMessageText(text, extra as ExtraEditMessageText);
      return;
    } catch (error) {
      const message = (error as Error).message;
      if (!message.includes("message is not modified")) {
        console.error("Could not edit Telegram message:", error);
      }
      if (message.includes("message is not modified")) return;
    }
  }
  await ctx.reply(text, extra);
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

function buildCatalogText(products: ProductSummary[]) {
  if (!products.length) return "Hiện chưa có sản phẩm đang bán.";

  const productLines = products.slice(0, CATALOG_TEXT_LIMIT).map((product, index) => {
    const category = product.category?.name ? ` - ${singleLine(product.category.name)}` : "";
    return `${index + 1}. ${singleLine(product.name)} - ${formatVnd(product.price)}${category}`;
  });
  const moreLine = products.length > CATALOG_TEXT_LIMIT ? `\n\nCòn ${products.length - CATALOG_TEXT_LIMIT} sản phẩm khác. Bấm nút bên dưới để xem tiếp.` : "";

  return [
    "Chọn sản phẩm bên dưới hoặc chat theo cú pháp:",
    "/xem 1 - xem sản phẩm số 1",
    "/mua 1 vi - mua bằng ví",
    "/mua 1 ck - mua bằng chuyển khoản QR",
    "",
    productLines.join("\n") + moreLine
  ].join("\n");
}

async function findProductByReference(reference: string) {
  const catalog = await api.get<CatalogResponse>("/bot/catalog");
  const products = flattenProducts(catalog);
  const trimmed = reference.trim();
  const index = Number(trimmed);
  const summary = Number.isInteger(index) && index >= 1 ? products[index - 1] : findProductByNameOrId(products, trimmed);
  if (!summary) return null;
  return api.get<ProductDetail>(`/bot/products/${summary.id}`);
}

function findProductByNameOrId(products: ProductSummary[], reference: string) {
  const normalizedReference = normalizeText(reference);
  return (
    products.find((product) => product.id === reference) ??
    products.find((product) => normalizeText(product.name) === normalizedReference) ??
    products.find((product) => normalizeText(product.name).includes(normalizedReference))
  );
}

function flattenProducts(catalog: CatalogResponse): ProductSummary[] {
  return [
    ...catalog.categories.flatMap((category) => category.products.map((product) => ({ ...product, category }))),
    ...catalog.uncategorized
  ];
}

function parsePurchaseArgs(args: string[]) {
  const lastArg = args.at(-1)?.toLocaleLowerCase("vi-VN");
  const method = parsePaymentMethod(lastArg);
  const productArgs = method ? args.slice(0, -1) : args;
  return {
    method,
    productReference: productArgs.join(" ").trim()
  };
}

function parsePaymentMethod(input?: string) {
  if (!input) return null;
  if (["vi", "ví", "wallet", "sodu", "sốdư"].includes(input)) return "wallet" as const;
  if (["ck", "qr", "bank", "chuyenkhoan", "chuyểnkhoản"].includes(input)) return "bank" as const;
  return null;
}

function parseVndAmount(input?: string) {
  if (!input) return null;
  const normalized = input.trim().toLocaleLowerCase("vi-VN").replace(/\s/g, "");
  const multiplier = normalized.endsWith("k") ? 1000 : 1;
  const numericPart = normalized.endsWith("k") ? normalized.slice(0, -1) : normalized;
  const digits = numericPart.replace(/[.,_]/g, "");
  if (!/^\d+$/.test(digits)) return null;
  const amount = Number(digits) * multiplier;
  return Number.isSafeInteger(amount) && amount > 0 ? amount : null;
}

function getCommandArgs(ctx: Context) {
  const text = ctx.message && "text" in ctx.message ? ctx.message.text : "";
  return text.trim().split(/\s+/).slice(1);
}

function normalizeText(input: string) {
  return input.trim().replace(/\s+/g, " ").toLocaleLowerCase("vi-VN");
}

function singleLine(input: string) {
  return input.replace(/\s+/g, " ").trim();
}

async function launch() {
  await configureTelegramMenu();
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

async function configureTelegramMenu() {
  await bot.telegram.setMyCommands(BOT_COMMANDS);
  await bot.telegram.setChatMenuButton({ menuButton: { type: "commands" } });
}

launch();

process.once("SIGINT", () => bot.stop("SIGINT"));
process.once("SIGTERM", () => bot.stop("SIGTERM"));
