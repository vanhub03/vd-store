import express from "express";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
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
import { escapeHtml, formatVnd, productAvailableQuantity, productStockLabel } from "./format";
import { currentCallbackMessageId, isCallbackContext } from "./telegram-context";

const token = process.env.TELEGRAM_BOT_TOKEN;
if (!token) {
  throw new Error("TELEGRAM_BOT_TOKEN is required for @vd-store/bot.");
}

const api = new ApiClient();
const bot = new Telegraf(token);
const CATALOG_BUTTON_LIMIT = 40;
const CATALOG_TEXT_LIMIT = 12;
const CAPTION_LIMIT = 1000;
const BOT_CARD_PNG = loadBotBannerPng();
const lastBotMessages = new Map<number, number>();
const BOT_COMMANDS = [
  { command: "start", description: "Bắt đầu sử dụng bot" },
  { command: "help", description: "Xem cú pháp chat nhanh" },
  { command: "menu", description: "Mở menu chính" },
  { command: "shop", description: "Mở danh sách sản phẩm" },
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
  "/shop - xem tất cả sản phẩm",
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

type ScreenKeyboard = ReturnType<typeof Markup.inlineKeyboard>;
type ScreenMedia = string | Buffer;
type BotLanguage = "vi" | "en";
type PaymentMethod = "wallet" | "bank" | "usdt";
const userLanguages = new Map<number, BotLanguage>();

function mainKeyboard() {
  return Markup.inlineKeyboard([
    [Markup.button.callback("Sản phẩm", "catalog"), Markup.button.callback("Số dư", "wallet")],
    [Markup.button.callback("Nạp tiền", "topup"), Markup.button.callback("Lịch sử", "history")],
    [Markup.button.callback("Hỗ trợ", "support"), Markup.button.callback("Hướng dẫn", "help")],
    [Markup.button.callback("Tiếng Việt", "lang:vi"), Markup.button.callback("English", "lang:en")]
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
bot.command("shop", (ctx) => showCatalog(ctx));
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

bot.action("noop", async (ctx) => {
  await ctx.answerCbQuery();
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
  await showQuantitySelection(ctx, ctx.match[1], 1, "wallet");
});

bot.action(/^buy_bank:(.+)$/, async (ctx) => {
  await ctx.answerCbQuery();
  await showQuantitySelection(ctx, ctx.match[1], 1, "bank");
});

bot.action(/^buy:(.+)$/, async (ctx) => {
  await ctx.answerCbQuery();
  await showQuantitySelection(ctx, ctx.match[1], 1);
});

bot.action(/^qty:([^:]+):(\d+)$/, async (ctx) => {
  await ctx.answerCbQuery();
  await showQuantitySelection(ctx, ctx.match[1], Number(ctx.match[2]));
});

bot.action(/^pay_wallet:([^:]+):(\d+)$/, async (ctx) => {
  await ctx.answerCbQuery();
  await purchaseWithWallet(ctx, ctx.match[1], Number(ctx.match[2]));
});

bot.action(/^pay_bank:([^:]+):(\d+)$/, async (ctx) => {
  await ctx.answerCbQuery();
  await createBankOrderQr(ctx, ctx.match[1], Number(ctx.match[2]));
});

bot.action(/^pay_usdt:([^:]+):(\d+)$/, async (ctx) => {
  await ctx.answerCbQuery();
  await createUsdtOrder(ctx, ctx.match[1], Number(ctx.match[2]));
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

bot.action(/^lang:(vi|en)$/, async (ctx) => {
  const language = ctx.match[1] as BotLanguage;
  if (ctx.from?.id) userLanguages.set(ctx.from.id, language);
  await ctx.answerCbQuery(language === "en" ? "English enabled" : "Đã chọn tiếng Việt");
  await showHome(ctx, language === "en" ? "Main menu\n\nPrices are shown in USDT when available." : undefined);
});

bot.on("text", async (ctx) => {
  const rawText = ctx.message.text.trim();
  const text = rawText.toLocaleLowerCase("vi-VN");
  const topupAmount = parseTopupAmountMessage(rawText);
  if (topupAmount) return createTopupQr(ctx, topupAmount);
  if (text === "help" || text === "tro giup" || text === "trợ giúp") return showHelp(ctx);
  if (text === "menu") return showHome(ctx);
  if (text === "shop") return showCatalog(ctx);
  if (text === "san pham" || text === "sản phẩm") return showCatalog(ctx);
  if (text === "so du" || text === "số dư") return showWallet(ctx);
  if (text === "lich su" || text === "lịch sử") return showHistory(ctx);
  return ctx.reply("Mình chưa hiểu lệnh này. Gửi /help để xem cú pháp chat nhanh.", mainKeyboard());
});

bot.catch(async (error, ctx) => {
  console.error(error);
  if (isCallbackContext(ctx)) {
    await renderScreen(ctx, `Có lỗi xảy ra: ${escapeHtml((error as Error).message)}`, mainKeyboard()).catch(() => undefined);
    return;
  }
  await ctx.reply(`Có lỗi xảy ra: ${(error as Error).message}`, mainKeyboard()).catch(() => undefined);
});

async function showCatalog(ctx: Context) {
  await upsertUser(ctx);
  const catalog = await api.get<CatalogResponse>("/bot/catalog");
  const products = flattenProducts(catalog);
  const buttons = products.slice(0, CATALOG_BUTTON_LIMIT).map((product, index) => [
    Markup.button.callback(productButtonLabel(product, index, currentLanguage(ctx)), `prod:${product.id}`)
  ]);
  buttons.push([Markup.button.callback("Quay lại", "home")]);
  await renderScreen(ctx, buildCatalogText(products, currentLanguage(ctx)), Markup.inlineKeyboard(buttons));
}

async function showWallet(ctx: Context) {
  await upsertUser(ctx);
  const wallet = await api.get<{ balance: number }>(`/bot/wallet/${ctx.from!.id}`);
  await renderScreen(ctx, `Số dư hiện tại: <b>${formatVnd(wallet.balance)}</b>`, mainKeyboard());
}

async function showTopup(ctx: Context) {
  await upsertUser(ctx);
  await renderScreen(
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
    ? history.orders
        .slice(0, 8)
        .map((order) => `${escapeHtml(order.code)} - ${escapeHtml(order.product.name)} - ${formatVnd(order.totalAmount)} - ${escapeHtml(order.status)}`)
        .join("\n")
    : "Chưa có đơn hàng.";
  const ledgerLines = history.ledger.length
    ? history.ledger
        .slice(0, 8)
        .map((entry) => `${formatVnd(entry.amount)} - ${escapeHtml(entry.type)}${entry.note ? ` - ${escapeHtml(entry.note)}` : ""}`)
        .join("\n")
    : "Chưa có giao dịch ví.";
  await renderScreen(ctx, `Đơn hàng gần đây:\n${orderLines}\n\nGiao dịch ví gần đây:\n${ledgerLines}`, mainKeyboard());
}

async function showSupport(ctx: Context) {
  await renderScreen(ctx, `Vui lòng liên hệ admin @${process.env.ADMIN_TELEGRAM_USERNAME ?? "vanhdao99"} để được hỗ trợ.`, mainKeyboard());
}

async function showHelp(ctx: Context) {
  await renderScreen(ctx, HELP_TEXT, mainKeyboard());
}

async function showHome(ctx: Context, message = "Menu chính\n\nGửi /help để xem cú pháp chat nhanh.") {
  await renderScreen(ctx, message, mainKeyboard());
}

async function showProduct(ctx: Context, productId: string) {
  const product = await api.get<ProductDetail>(`/bot/products/${productId}`);
  await showProductDetail(ctx, product);
}

async function showProductDetail(ctx: Context, product: ProductDetail) {
  const lang = currentLanguage(ctx);
  const description = localizedDescription(product, lang) ? `\n${escapeHtml(localizedDescription(product, lang)!)}` : "";
  const categoryLine = product.category?.name ? `Danh mục: <b>${escapeHtml(product.category.name)}</b>\n` : "";
  const caption = `${categoryLine}<b>${escapeHtml(productIcon(product))} ${escapeHtml(localizedName(product, lang))}</b>${description}\nGiá: <b>${localizedPrice(product, lang)}</b>\n${productStockLabel(
    product
  )}\n\nChat nhanh: /mua ${escapeHtml(product.name)} vi hoặc /mua ${escapeHtml(product.name)} ck`;
  const keyboard = Markup.inlineKeyboard([
    [Markup.button.callback("Mua bằng ví", `buy_wallet:${product.id}`)],
    [Markup.button.callback("Chuyển khoản QR", `buy_bank:${product.id}`)],
    [Markup.button.callback("Quay lại", "catalog")]
  ]);

  await renderScreen(ctx, caption, keyboard);
}

async function showQuantitySelection(ctx: Context, productId: string, quantity: number, preferredMethod?: PaymentMethod) {
  await upsertUser(ctx);
  const product = await api.get<ProductDetail>(`/bot/products/${productId}`);
  const available = productAvailableQuantity(product);
  if (available === 0) {
    await renderScreen(
      ctx,
      `${escapeHtml(productIcon(product))} <b>${escapeHtml(product.name)}</b>\n\nSan pham hien da het hang.`,
      Markup.inlineKeyboard([[Markup.button.callback("Quay lai", `prod:${product.id}`)]])
    );
    return;
  }

  const safeQuantity = clampQuantity(quantity, product);
  const stockLine = available === null ? "Kho: khong gioi han" : `Kho: ${available}`;
  const methodHint =
    preferredMethod === "wallet"
      ? "\nBan dang chon thanh toan bang vi. Kiem tra so luong roi bam xac nhan."
      : preferredMethod === "bank"
        ? "\nBan dang chon chuyen khoan QR. Kiem tra so luong roi bam tao QR."
        : "";

  await renderScreen(
    ctx,
    [
      `<b>${escapeHtml(productIcon(product))} ${escapeHtml(localizedName(product, currentLanguage(ctx)))}</b>`,
      localizedDescription(product, currentLanguage(ctx)) ? escapeHtml(localizedDescription(product, currentLanguage(ctx))!) : "",
      `Gia: <b>${localizedPrice(product, currentLanguage(ctx))}</b>`,
      stockLine,
      "",
      `So luong dang chon: <b>${safeQuantity}</b>`,
      `Tong thanh toan: <b>${localizedTotal(product, safeQuantity, currentLanguage(ctx))}</b>${methodHint}`
    ]
      .filter(Boolean)
      .join("\n"),
    quantityKeyboard(product, safeQuantity, preferredMethod)
  );
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
    await showQuantitySelection(ctx, product.id, 1);
    return;
  }

  await showQuantitySelection(ctx, product.id, 1, parsed.method);
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

async function purchaseWithWallet(ctx: Context, productId: string, quantity = 1) {
  await upsertUser(ctx);
  const result = await api.post<WalletPurchaseResponse>("/bot/orders/wallet", {
    telegramId: String(ctx.from!.id),
    productId,
    quantity
  });
  await renderFinalDelivery(
    ctx,
    `Mua hàng thành công.\nSố dư còn lại: <b>${formatVnd(
      result.balanceAfter
    )}</b>\n\nHàng của bạn:\n<pre>${escapeHtml(result.deliveryText)}</pre>`
  );
}

async function createBankOrderQr(ctx: Context, productId: string, quantity = 1) {
  await upsertUser(ctx);
  const result = await api.post<PaymentResponse>("/bot/orders/bank", {
    telegramId: String(ctx.from!.id),
    productId,
    quantity
  });
  await sendQr(ctx, result.payment.id, result.qrImageUrl, buildQrCaption("Mua hàng", result.code, result.amount, result.expiresAt));
}

async function createUsdtOrder(ctx: Context, productId: string, quantity = 1) {
  await upsertUser(ctx);
  const result = await api.post<PaymentResponse>("/bot/orders/usdt", {
    telegramId: String(ctx.from!.id),
    productId,
    quantity
  });
  const amount = formatUsdt(result.cryptoAmount);
  const caption = [
    "USDT Binance Pay",
    `Amount: <b>${amount} USDT</b>`,
    `Order: <code>${escapeHtml(result.code)}</code>`,
    result.checkoutUrl ? `Checkout: ${escapeHtml(result.checkoutUrl)}` : null,
    `Expires: ${new Date(result.expiresAt).toLocaleString("vi-VN")}`,
    "System will auto process after Binance Pay confirms."
  ]
    .filter(Boolean)
    .join("\n");
  if (result.qrImageUrl) {
    await sendQr(ctx, result.payment.id, result.qrImageUrl, caption);
    return;
  }
  await renderScreen(ctx, caption, mainKeyboard());
}

async function renderScreen(ctx: Context, caption: string, keyboard?: ScreenKeyboard, media?: ScreenMedia) {
  const safeCaption = fitCaption(caption);
  if (isCallbackContext(ctx)) {
    if (media) {
      const updatedMedia = await editCurrentMedia(ctx, media, safeCaption, keyboard);
      if (updatedMedia) return updatedMedia;
    }

    const updatedCaption = await editCurrentCaption(ctx, safeCaption, keyboard);
    if (updatedCaption) return updatedCaption;

    const updatedText = await editCurrentText(ctx, safeCaption, keyboard);
    if (updatedText) return updatedText;

    await ctx.answerCbQuery("Không cập nhật được tin nhắn này. Gửi /start để mở menu mới.", { show_alert: true }).catch(() => undefined);
    return null;
  }

  const sent = await replyWithScreenPhoto(ctx, media ?? BOT_CARD_PNG, safeCaption, keyboard);
  if (ctx.chat) rememberBotMessage(ctx.chat.id, sent.message_id);
  return sent.message_id;
}

async function renderFinalDelivery(ctx: Context, caption: string) {
  const safeCaption = fitCaption(caption);
  if (isCallbackContext(ctx)) {
    const updatedCaption = await editCurrentCaption(ctx, safeCaption, undefined, true);
    if (updatedCaption) return updatedCaption;

    const updatedText = await editCurrentText(ctx, safeCaption, undefined, true);
    if (updatedText) return updatedText;
  }

  const sent = await replyWithScreenPhoto(ctx, BOT_CARD_PNG, safeCaption);
  if (ctx.chat) rememberBotMessage(ctx.chat.id, sent.message_id);
  return sent.message_id;
}

async function replyWithScreenPhoto(ctx: Context, media: ScreenMedia, caption: string, keyboard?: ScreenKeyboard) {
  try {
    return await ctx.replyWithPhoto(toTelegramPhoto(media), {
      caption,
      parse_mode: "HTML",
      ...(keyboard ?? {})
    } as ExtraReplyMessage);
  } catch (error) {
    if (typeof media !== "string") throw error;
    console.error("Could not send Telegram screen photo, falling back to default card:", error);
    return ctx.replyWithPhoto(toTelegramPhoto(BOT_CARD_PNG), {
      caption,
      parse_mode: "HTML",
      ...(keyboard ?? {})
    } as ExtraReplyMessage);
  }
}

async function editCurrentMedia(ctx: Context, media: ScreenMedia, caption: string, keyboard?: ScreenKeyboard, removeKeyboard = false) {
  const chatId = ctx.chat?.id;
  const messageId = currentCallbackMessageId(ctx);
  if (!chatId || !messageId) return null;

  try {
    await ctx.editMessageMedia(
      {
        type: "photo",
        media: toTelegramPhoto(media),
        caption,
        parse_mode: "HTML"
      },
      editMarkupOptions(keyboard, removeKeyboard) as never
    );
    rememberBotMessage(chatId, messageId);
    return messageId;
  } catch (error) {
    if ((error as Error).message.includes("message is not modified")) return messageId;
    if (typeof media !== "string") {
      console.error("Could not edit Telegram media:", error);
      return null;
    }

    try {
      await ctx.editMessageMedia(
        {
          type: "photo",
          media: toTelegramPhoto(BOT_CARD_PNG),
          caption,
          parse_mode: "HTML"
        },
        editMarkupOptions(keyboard, removeKeyboard) as never
      );
      rememberBotMessage(chatId, messageId);
      return messageId;
    } catch (fallbackError) {
      if ((fallbackError as Error).message.includes("message is not modified")) return messageId;
      console.error("Could not edit Telegram media:", fallbackError);
      return null;
    }
  }
}

async function editCurrentCaption(ctx: Context, caption: string, keyboard?: ScreenKeyboard, removeKeyboard = false) {
  const chatId = ctx.chat?.id;
  const messageId = currentCallbackMessageId(ctx);
  if (!chatId || !messageId) return null;

  try {
    await ctx.editMessageCaption(caption, {
      parse_mode: "HTML",
      ...editMarkupOptions(keyboard, removeKeyboard)
    } as never);
    rememberBotMessage(chatId, messageId);
    return messageId;
  } catch (error) {
    const message = (error as Error).message;
    if (message.includes("message is not modified")) return messageId;
    console.error("Could not edit Telegram caption:", error);
    return null;
  }
}

async function editCurrentText(ctx: Context, text: string, keyboard?: ScreenKeyboard, removeKeyboard = false) {
  const chatId = ctx.chat?.id;
  const messageId = currentCallbackMessageId(ctx);
  if (!chatId || !messageId) return null;

  try {
    await ctx.editMessageText(text, {
      parse_mode: "HTML",
      ...editMarkupOptions(keyboard, removeKeyboard)
    } as ExtraEditMessageText);
    rememberBotMessage(chatId, messageId);
    return messageId;
  } catch (error) {
    const message = (error as Error).message;
    if (message.includes("message is not modified")) return messageId;
    console.error("Could not edit Telegram text:", error);
    return null;
  }
}

async function sendQr(ctx: Context, paymentId: string, qrImageUrl: string, caption: string) {
  const buffer = await fetchQrImage(qrImageUrl);
  const messageId = isCallbackContext(ctx) ? await editCurrentMedia(ctx, buffer, caption) : await sendQrPhoto(ctx, buffer, caption);
  if (!messageId) {
    await editCurrentCaption(
      ctx,
      `${caption}\n\nKhông thể đổi menu cũ sang ảnh QR. Gửi lại bằng cú pháp /nap số_tiền hoặc /mua sản_phẩm ck để tạo QR mới.`,
      mainKeyboard()
    );
    return;
  }

  await api.post(`/bot/payments/${paymentId}/telegram-message`, {
    telegramChatId: String(ctx.chat!.id),
    telegramMessageId: messageId
  });
}

async function fetchQrImage(qrImageUrl: string) {
  const image = await fetch(qrImageUrl);
  if (!image.ok) throw new Error(`Không tải được ảnh VietQR. HTTP ${image.status}`);

  const contentType = image.headers.get("content-type") ?? "";
  if (!contentType.includes("image")) {
    throw new Error(`Không tải được ảnh VietQR. Server trả về ${contentType || "unknown content type"}.`);
  }

  return Buffer.from(await image.arrayBuffer());
}

async function sendQrPhoto(ctx: Context, buffer: Buffer, caption: string) {
  const sent = await ctx.replyWithPhoto(toTelegramPhoto(buffer), { caption, parse_mode: "HTML" });
  if (ctx.chat) rememberBotMessage(ctx.chat.id, sent.message_id);
  return sent.message_id;
}

function rememberBotMessage(chatId: number, messageId: number) {
  lastBotMessages.set(chatId, messageId);
}

function buildQrCaption(title: string, code: string, amount: number, expiresAt: string) {
  return `${title}\nSố tiền: <b>${formatVnd(amount)}</b>\nNội dung CK: <code>${escapeHtml(code)}</code>\nHạn thanh toán: ${new Date(
    expiresAt
  ).toLocaleString("vi-VN")}\nHệ thống sẽ tự xử lý khi nhận tiền.`;
}

function buildCatalogText(products: ProductSummary[], language: BotLanguage) {
  if (!products.length) return "Hiện chưa có sản phẩm đang bán.";

  const productLines = products.slice(0, CATALOG_TEXT_LIMIT).map((product, index) => {
    const category = product.category?.name ? ` - ${escapeHtml(singleLine(product.category.name))}` : "";
    return `${index + 1}. ${escapeHtml(productStateIcon(product))} ${escapeHtml(singleLine(localizedName(product, language)))} - ${localizedPrice(
      product,
      language
    )} - 📦 ${productQuantityText(product)}${category}`;
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

function productQuantityText(product: ProductSummary | ProductDetail) {
  const quantity = productAvailableQuantity(product);
  return quantity === null ? "không giới hạn" : String(quantity);
}

function productButtonLabel(product: ProductSummary, index: number, language: BotLanguage) {
  return `${index + 1}. ${productStateIcon(product)} ${localizedName(product, language)} - ${localizedPrice(product, language)} | 📦 ${productQuantityText(product)}`;
}

function productStateIcon(product: ProductSummary | ProductDetail) {
  const quantity = productAvailableQuantity(product);
  if (quantity === 0) return "❌";
  return productIcon(product);
}

function productIcon(product: ProductSummary | ProductDetail) {
  return product.buttonIcon?.trim() || "🛍️";
}

function currentLanguage(ctx: Context): BotLanguage {
  return ctx.from?.id ? userLanguages.get(ctx.from.id) ?? "vi" : "vi";
}

function localizedName(product: ProductSummary | ProductDetail, language: BotLanguage) {
  return language === "en" ? product.nameEn?.trim() || product.name : product.name;
}

function localizedDescription(product: ProductSummary | ProductDetail, language: BotLanguage) {
  return language === "en" ? product.descriptionEn?.trim() || product.description : product.description;
}

function localizedPrice(product: ProductSummary | ProductDetail, language: BotLanguage) {
  return language === "en" && product.usdtPrice ? `${formatUsdt(product.usdtPrice)} USDT` : formatVnd(product.price);
}

function localizedTotal(product: ProductSummary | ProductDetail, quantity: number, language: BotLanguage) {
  if (language === "en" && product.usdtPrice) {
    return `${formatUsdt(Number(product.usdtPrice) * quantity)} USDT`;
  }
  return formatVnd(product.price * quantity);
}

function formatUsdt(value: string | number | null | undefined) {
  const amount = Number(value ?? 0);
  if (!Number.isFinite(amount)) return "0";
  return amount.toLocaleString("en-US", { maximumFractionDigits: 8 });
}

function quantityKeyboard(product: ProductDetail, quantity: number, preferredMethod?: PaymentMethod) {
  const previousQuantity = clampQuantity(quantity - 1, product);
  const nextQuantity = clampQuantity(quantity + 1, product);
  const quickQuantities = [1, 2, 5, 10]
    .map((value) => clampQuantity(value, product))
    .filter((value, index, values) => values.indexOf(value) === index && value !== quantity);
  const paymentRows =
    preferredMethod === "wallet"
      ? [
          [Markup.button.callback(`Xac nhan mua bang vi - ${quantity}`, `pay_wallet:${product.id}:${quantity}`)],
          [Markup.button.callback("Doi sang QR", `pay_bank:${product.id}:${quantity}`)]
        ]
      : preferredMethod === "bank"
        ? [
            [Markup.button.callback(`Tao QR cho ${quantity} san pham`, `pay_bank:${product.id}:${quantity}`)],
            [Markup.button.callback("Doi sang vi", `pay_wallet:${product.id}:${quantity}`)]
          ]
        : [
            [
              Markup.button.callback("Mua bang vi", `pay_wallet:${product.id}:${quantity}`),
              Markup.button.callback("Chuyen khoan QR", `pay_bank:${product.id}:${quantity}`)
            ],
            [Markup.button.callback("USDT Binance Pay", `pay_usdt:${product.id}:${quantity}`)]
          ];

  return Markup.inlineKeyboard([
    [
      Markup.button.callback("-", `qty:${product.id}:${previousQuantity}`),
      Markup.button.callback(`SL: ${quantity}`, "noop"),
      Markup.button.callback("+", `qty:${product.id}:${nextQuantity}`)
    ],
    ...(quickQuantities.length ? [quickQuantities.map((value) => Markup.button.callback(String(value), `qty:${product.id}:${value}`))] : []),
    ...paymentRows,
    [Markup.button.callback("Quay lai", `prod:${product.id}`)]
  ]);
}

function clampQuantity(quantity: number, product: ProductSummary | ProductDetail) {
  const available = productAvailableQuantity(product);
  const max = available === null ? 99 : Math.max(1, available);
  if (!Number.isFinite(quantity)) return 1;
  return Math.min(Math.max(1, Math.trunc(quantity)), max);
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

function parseTopupAmountMessage(input: string) {
  const normalized = input.trim().toLocaleLowerCase("vi-VN");
  if (!/^[\d\s.,_]+k?$/.test(normalized)) return null;
  return parseVndAmount(normalized);
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

function toTelegramPhoto(media: ScreenMedia) {
  if (typeof media === "string") return media;
  return { source: media, filename: "vd-store.png" };
}

function loadBotBannerPng() {
  const configuredPath = process.env.BOT_BANNER_PATH?.trim();
  const candidates = [
    ...(configuredPath ? [configuredPath] : []),
    resolve(process.cwd(), "assets", "banner.png"),
    resolve(__dirname, "..", "assets", "banner.png"),
    resolve(__dirname, "..", "..", "apps", "bot", "assets", "banner.png")
  ];
  const bannerPath = candidates.find((candidate) => existsSync(candidate));
  if (!bannerPath) {
    throw new Error(`Không tìm thấy banner bot. Đã thử: ${candidates.join(", ")}`);
  }
  return readFileSync(bannerPath);
}

function editMarkupOptions(keyboard?: ScreenKeyboard, removeKeyboard = false) {
  if (keyboard) return keyboard;
  return removeKeyboard ? { reply_markup: { inline_keyboard: [] } } : {};
}

function fitCaption(caption: string) {
  if (caption.length <= CAPTION_LIMIT) return caption;
  return `${caption.slice(0, CAPTION_LIMIT - 20).trim()}\n\n...`;
}

async function launch() {
  const mode = process.env.TELEGRAM_BOT_MODE ?? "polling";
  if (mode === "webhook") {
    const publicUrl = process.env.TELEGRAM_WEBHOOK_PUBLIC_URL;
    if (!publicUrl) throw new Error("TELEGRAM_WEBHOOK_PUBLIC_URL is required in webhook mode.");
    const path = process.env.TELEGRAM_WEBHOOK_PATH ?? "/telegram/webhook";
    await withTimeout(bot.telegram.setWebhook(`${publicUrl}${path}`), 10_000, "setWebhook");
    const app = express();
    registerHealthRoutes(app);
    app.use(bot.webhookCallback(path));
    const port = Number(process.env.BOT_PORT ?? process.env.PORT ?? 3001);
    app.listen(port, () => console.log(`VD Store bot webhook listening on ${port}${path}`));
    configureTelegramMenu().catch((error) => console.error("Telegram menu setup failed:", error));
    return;
  }

  bot.launch().catch((error) => {
    console.error("VD Store bot polling failed:", error);
    process.exit(1);
  });
  console.log("VD Store bot started in polling mode.");
  startHealthServer();
  configureTelegramMenu().catch((error) => console.error("Telegram menu setup failed:", error));
}

async function configureTelegramMenu() {
  await withTimeout(bot.telegram.setMyCommands(BOT_COMMANDS), 10_000, "setMyCommands");
  await withTimeout(bot.telegram.setChatMenuButton({ menuButton: { type: "commands" } }), 10_000, "setChatMenuButton");
}

launch();

function startHealthServer() {
  const app = express();
  registerHealthRoutes(app);
  const port = Number(process.env.BOT_PORT ?? process.env.PORT ?? 3001);
  app.listen(port, () => console.log(`VD Store bot health listening on ${port}`));
}

function registerHealthRoutes(app: express.Express) {
  app.get("/health", (_request, response) => {
    response.json({ ok: true, service: "vd-store-bot", mode: process.env.TELEGRAM_BOT_MODE ?? "polling", timestamp: new Date().toISOString() });
  });
  app.get("/assets/bot-card.png", (_request, response) => {
    response.type("png").send(BOT_CARD_PNG);
  });
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, label: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${label} timed out after ${timeoutMs}ms`)), timeoutMs);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      }
    );
  });
}

function stopBot(signal: "SIGINT" | "SIGTERM") {
  try {
    bot.stop(signal);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message !== "Bot is not running!") {
      console.error(`Failed to stop Telegram bot on ${signal}:`, error);
    }
  }
}

process.once("SIGINT", () => stopBot("SIGINT"));
process.once("SIGTERM", () => stopBot("SIGTERM"));
