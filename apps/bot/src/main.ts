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

const HELP_TEXT_EN = [
  "Quick commands:",
  "/menu - open main menu",
  "/shop - view all products",
  "/xem 1 - view product by catalog number",
  "/xem product name - search product by name",
  "/mua 1 usdt - create a Cryptomus USDT invoice",
  "/mua 1 wallet - pay with wallet balance",
  "/mua 1 bank - create a bank QR",
  "/sodu - view wallet balance",
  "/lichsu - view order and wallet history",
  "/hotro - contact support",
  "",
  "Use /shop first to see product numbers. In English mode, USDT invoice is the default payment flow."
].join("\n");

type ScreenKeyboard = ReturnType<typeof Markup.inlineKeyboard>;
type ScreenMedia = string | Buffer;
type BotLanguage = "vi" | "en";
type PaymentMethod = "wallet" | "bank" | "usdt";
type PendingQuantity = {
  productId: string;
  preferredMethod?: PaymentMethod;
  createdAt: number;
};

const userLanguages = new Map<number, BotLanguage>();
const pendingQuantities = new Map<number, PendingQuantity>();

const BOT_TEXT = {
  vi: {
    products: "Sản phẩm",
    wallet: "Số dư",
    topup: "Nạp tiền",
    history: "Lịch sử",
    support: "Hỗ trợ",
    help: "Hướng dẫn",
    back: "Quay lại",
    home: "Menu chính\n\nGửi /help để xem cú pháp chat nhanh.",
    start: "Chào bạn. Đây là bot bán hàng tự động.\nBạn có thể xem sản phẩm, nạp tiền, mua hàng và kiểm tra lịch sử ngay trong bot.\n\nGửi /help để xem cú pháp chat nhanh.",
    unknown: "Mình chưa hiểu lệnh này. Gửi /help để xem cú pháp chat nhanh.",
    noProducts: "Hiện chưa có sản phẩm đang bán.",
    walletBalance: "Số dư hiện tại",
    topupHint: "Chọn số tiền cần nạp. QR có hiệu lực trong 10 phút.\n\nBạn cũng có thể chat: /nap 100000",
    recentOrders: "Đơn hàng gần đây",
    recentLedger: "Giao dịch ví gần đây",
    noOrders: "Chưa có đơn hàng.",
    noLedger: "Chưa có giao dịch ví.",
    contactAdmin: "Vui lòng liên hệ admin",
    contactSupport: "để được hỗ trợ.",
    category: "Danh mục",
    price: "Giá",
    quickChat: "Chat nhanh",
    buyWallet: "Mua bằng ví",
    bankQr: "Chuyển khoản QR",
    buyUsdt: "USDT Cryptomus",
    chooseProduct: "Chọn sản phẩm bên dưới hoặc chat theo cú pháp:",
    viewProduct: "/xem 1 - xem sản phẩm số 1",
    buyWalletSyntax: "/mua 1 vi - mua bằng ví",
    buyBankSyntax: "/mua 1 ck - mua bằng chuyển khoản QR",
    buyUsdtSyntax: "/mua 1 usdt - mua bằng USDT Cryptomus",
    moreProducts: "sản phẩm khác. Bấm nút bên dưới để xem tiếp.",
    stock: "Kho",
    unlimited: "không giới hạn",
    outOfStock: "Sản phẩm hiện đã hết hàng.",
    selectedQty: "Số lượng đang chọn",
    total: "Tổng thanh toán",
    walletHint: "Bạn đang chọn thanh toán bằng ví. Kiểm tra số lượng rồi bấm xác nhận.",
    bankHint: "Bạn đang chọn chuyển khoản QR. Kiểm tra số lượng rồi bấm tạo QR.",
    usdtHint: "Bạn đang chọn USDT Cryptomus. Kiểm tra số lượng rồi bấm tạo invoice.",
    confirmWallet: "Xác nhận mua bằng ví",
    createBankQr: "Tạo QR",
    createUsdtInvoice: "Tạo USDT invoice",
    switchWallet: "Đổi sang ví",
    switchBank: "Đổi sang QR",
    minTopupError: "Số tiền nạp không hợp lệ.\nVí dụ: /nap 100000 hoặc /nap 100k",
    missingProduct: "Thiếu sản phẩm cần mua.\nVí dụ: /mua 1 vi hoặc /mua 1 ck",
    notFoundPrefix: "Không tìm thấy sản phẩm",
    useCatalog: "Gửi /sanpham để xem danh sách.",
    topupTitle: "Nạp tiền",
    orderTitle: "Mua hàng",
    bankContent: "Nội dung CK",
    expires: "Hạn thanh toán",
    autoProcess: "Hệ thống sẽ tự xử lý khi nhận tiền.",
    paidSuccess: "Mua hàng thành công.",
    balanceAfter: "Số dư còn lại",
    yourGoods: "Hàng của bạn",
    qrFallback: "Không thể tải ảnh QR. Bạn vẫn có thể mở link/kiểm tra thông tin thanh toán bên dưới.",
    copyWarning: "Chỉ chuyển USDT đúng network hiển thị. Chuyển sai network có thể mất tiền.",
    network: "Network",
    checkout: "Checkout",
    quantityPrompt: "Nhập số lượng bạn muốn mua vào ô chat rồi gửi.",
    quantityExample: "Ví dụ: 2",
    quantityInvalid: "Số lượng không hợp lệ. Vui lòng chỉ nhập số nguyên lớn hơn 0, ví dụ: 2",
    quantityChoosePayment: "Đã nhận số lượng. Chọn phương thức thanh toán để tiếp tục.",
    quantityWalletNext: "Sau khi gửi số lượng, bot sẽ mua bằng ví.",
    quantityBankNext: "Sau khi gửi số lượng, bot sẽ tạo QR chuyển khoản.",
    quantityUsdtNext: "Sau khi gửi số lượng, bot sẽ tạo invoice USDT."
  },
  en: {
    products: "Products",
    wallet: "Balance",
    topup: "Top up",
    history: "History",
    support: "Support",
    help: "Help",
    back: "Back",
    home: "Main menu\n\nUse /help to view quick commands. English checkout uses USDT invoices when available.",
    start: "Welcome to VD AI Shop.\nYou can browse products, create USDT invoices and check order history in this bot.\n\nUse /help to view quick commands.",
    unknown: "I don't understand this command. Use /help to view quick commands.",
    noProducts: "There are no active products yet.",
    walletBalance: "Current balance",
    topupHint: "Choose a VND top-up amount. The QR is valid for 10 minutes.\n\nYou can also type: /nap 100000",
    recentOrders: "Recent orders",
    recentLedger: "Recent wallet transactions",
    noOrders: "No orders yet.",
    noLedger: "No wallet transactions yet.",
    contactAdmin: "Please contact admin",
    contactSupport: "for support.",
    category: "Category",
    price: "Price",
    quickChat: "Quick command",
    buyWallet: "Pay with wallet",
    bankQr: "Bank QR",
    buyUsdt: "Pay with USDT",
    chooseProduct: "Choose a product below or use a command:",
    viewProduct: "/xem 1 - view product #1",
    buyWalletSyntax: "/mua 1 wallet - pay with wallet",
    buyBankSyntax: "/mua 1 bank - pay with bank QR",
    buyUsdtSyntax: "/mua 1 usdt - create a Cryptomus invoice",
    moreProducts: "more products. Use the buttons below to continue.",
    stock: "Stock",
    unlimited: "unlimited",
    outOfStock: "This product is currently out of stock.",
    selectedQty: "Selected quantity",
    total: "Total",
    walletHint: "You selected wallet payment. Check the quantity and confirm.",
    bankHint: "You selected bank QR. Check the quantity and create a QR.",
    usdtHint: "You selected USDT Cryptomus. Check the quantity and create an invoice.",
    confirmWallet: "Confirm wallet payment",
    createBankQr: "Create bank QR",
    createUsdtInvoice: "Create USDT invoice",
    switchWallet: "Switch to wallet",
    switchBank: "Switch to bank QR",
    minTopupError: "Invalid top-up amount.\nExample: /nap 100000 or /nap 100k",
    missingProduct: "Missing product.\nExample: /mua 1 usdt",
    notFoundPrefix: "Product not found",
    useCatalog: "Use /shop to view the catalog.",
    topupTitle: "Top up",
    orderTitle: "Order payment",
    bankContent: "Transfer content",
    expires: "Payment expires",
    autoProcess: "The system will process automatically after payment is received.",
    paidSuccess: "Purchase successful.",
    balanceAfter: "Balance after purchase",
    yourGoods: "Your delivery",
    qrFallback: "Could not load the QR image. You can still open the checkout link or use the payment details below.",
    copyWarning: "Only send USDT through the displayed network. Sending via the wrong network may permanently lose funds.",
    network: "Network",
    checkout: "Checkout",
    quantityPrompt: "Type the quantity you want to buy in the chat box and send it.",
    quantityExample: "Example: 2",
    quantityInvalid: "Invalid quantity. Please send a positive whole number, for example: 2",
    quantityChoosePayment: "Quantity received. Choose a payment method to continue.",
    quantityWalletNext: "After you send the quantity, the bot will pay with wallet balance.",
    quantityBankNext: "After you send the quantity, the bot will create a bank QR.",
    quantityUsdtNext: "After you send the quantity, the bot will create a USDT invoice."
  }
} as const;

function mainKeyboard(language: BotLanguage = "vi") {
  const text = BOT_TEXT[language];
  return Markup.inlineKeyboard([
    [Markup.button.callback(text.products, "catalog"), Markup.button.callback(text.wallet, "wallet")],
    [Markup.button.callback(text.topup, "topup"), Markup.button.callback(text.history, "history")],
    [Markup.button.callback(text.support, "support"), Markup.button.callback(text.help, "help")],
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
  await showHome(ctx, BOT_TEXT[currentLanguage(ctx)].start);
});

bot.command("help", (ctx) => showHelp(ctx));
bot.command("menu", (ctx) => showHome(ctx));
bot.command("shop", (ctx) => showCatalog(ctx));
bot.command("sanpham", (ctx) => showCatalog(ctx));
bot.command("xem", (ctx) => showProductByCommand(ctx));
bot.command("mua", (ctx) => purchaseByCommand(ctx));
bot.command("buy", (ctx) => purchaseByCommand(ctx));
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
  await showQuantitySelection(ctx, ctx.match[1], 1, currentLanguage(ctx) === "en" ? "usdt" : "wallet");
});

bot.action(/^buy_bank:(.+)$/, async (ctx) => {
  await ctx.answerCbQuery();
  await showQuantitySelection(ctx, ctx.match[1], 1, currentLanguage(ctx) === "en" ? "usdt" : "bank");
});

bot.action(/^buy_usdt:(.+)$/, async (ctx) => {
  await ctx.answerCbQuery();
  await showQuantitySelection(ctx, ctx.match[1], 1, "usdt");
});

bot.action(/^buy:(.+)$/, async (ctx) => {
  await ctx.answerCbQuery();
  await showQuantitySelection(ctx, ctx.match[1], 1, currentLanguage(ctx) === "en" ? "usdt" : undefined);
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
  if (await handlePendingQuantityText(ctx, rawText)) return;
  const text = rawText.toLocaleLowerCase("vi-VN");
  const topupAmount = parseTopupAmountMessage(rawText);
  if (topupAmount) return createTopupQr(ctx, topupAmount);
  if (text === "help" || text === "tro giup" || text === "trợ giúp") return showHelp(ctx);
  if (text === "menu") return showHome(ctx);
  if (text === "shop") return showCatalog(ctx);
  if (text === "san pham" || text === "sản phẩm" || text === "products") return showCatalog(ctx);
  if (text === "so du" || text === "số dư" || text === "balance") return showWallet(ctx);
  if (text === "lich su" || text === "lịch sử" || text === "history") return showHistory(ctx);
  return ctx.reply(BOT_TEXT[currentLanguage(ctx)].unknown, mainKeyboard(currentLanguage(ctx)));
});

bot.catch(async (error, ctx) => {
  console.error(error);
  if (isCallbackContext(ctx)) {
    const lang = currentLanguage(ctx);
    await renderScreen(ctx, `${lang === "en" ? "Error" : "Có lỗi xảy ra"}: ${escapeHtml((error as Error).message)}`, mainKeyboard(lang)).catch(() => undefined);
    return;
  }
  await ctx.reply(`Có lỗi xảy ra: ${(error as Error).message}`, mainKeyboard(currentLanguage(ctx))).catch(() => undefined);
});

async function showCatalog(ctx: Context) {
  await upsertUser(ctx);
  clearPendingQuantity(ctx);
  const lang = currentLanguage(ctx);
  const catalog = await api.get<CatalogResponse>("/bot/catalog");
  const products = flattenProducts(catalog);
  const buttons = products.slice(0, CATALOG_BUTTON_LIMIT).map((product, index) => [
    Markup.button.callback(productButtonLabel(product, index, lang), `prod:${product.id}`)
  ]);
  buttons.push([Markup.button.callback(BOT_TEXT[lang].back, "home")]);
  await renderScreen(ctx, buildCatalogText(products, lang), Markup.inlineKeyboard(buttons));
}

async function showWallet(ctx: Context) {
  await upsertUser(ctx);
  const lang = currentLanguage(ctx);
  const wallet = await api.get<{ balance: number }>(`/bot/wallet/${ctx.from!.id}`);
  await renderScreen(ctx, `${BOT_TEXT[lang].walletBalance}: <b>${formatVnd(wallet.balance)}</b>`, mainKeyboard(lang));
}

async function showTopup(ctx: Context) {
  await upsertUser(ctx);
  const lang = currentLanguage(ctx);
  await renderScreen(
    ctx,
    BOT_TEXT[lang].topupHint,
    Markup.inlineKeyboard([
      [Markup.button.callback("50.000đ", "topup:50000"), Markup.button.callback("100.000đ", "topup:100000")],
      [Markup.button.callback("200.000đ", "topup:200000"), Markup.button.callback("500.000đ", "topup:500000")],
      [Markup.button.callback(BOT_TEXT[lang].back, "home")]
    ])
  );
}

async function showHistory(ctx: Context) {
  await upsertUser(ctx);
  const lang = currentLanguage(ctx);
  const text = BOT_TEXT[lang];
  const history = await api.get<HistoryResponse>(`/bot/history/${ctx.from!.id}`);
  const orderLines = history.orders.length
    ? history.orders
        .slice(0, 8)
        .map((order) => `${escapeHtml(order.code)} - ${escapeHtml(order.product.name)} - ${formatVnd(order.totalAmount)} - ${escapeHtml(order.status)}`)
        .join("\n")
    : text.noOrders;
  const ledgerLines = history.ledger.length
    ? history.ledger
        .slice(0, 8)
        .map((entry) => `${formatVnd(entry.amount)} - ${escapeHtml(entry.type)}${entry.note ? ` - ${escapeHtml(entry.note)}` : ""}`)
        .join("\n")
    : text.noLedger;
  await renderScreen(ctx, `${text.recentOrders}:\n${orderLines}\n\n${text.recentLedger}:\n${ledgerLines}`, mainKeyboard(lang));
}

async function showSupport(ctx: Context) {
  const lang = currentLanguage(ctx);
  await renderScreen(ctx, `${BOT_TEXT[lang].contactAdmin} @${process.env.ADMIN_TELEGRAM_USERNAME ?? "vanhdao99"} ${BOT_TEXT[lang].contactSupport}`, mainKeyboard(lang));
}

async function showHelp(ctx: Context) {
  const lang = currentLanguage(ctx);
  await renderScreen(ctx, lang === "en" ? HELP_TEXT_EN : HELP_TEXT, mainKeyboard(lang));
}

async function showHome(ctx: Context, message?: string) {
  clearPendingQuantity(ctx);
  const lang = currentLanguage(ctx);
  await renderScreen(ctx, message ?? BOT_TEXT[lang].home, mainKeyboard(lang));
}

async function showProduct(ctx: Context, productId: string) {
  const product = await api.get<ProductDetail>(`/bot/products/${productId}`);
  await showProductDetail(ctx, product);
}

async function showProductDetail(ctx: Context, product: ProductDetail) {
  clearPendingQuantity(ctx);
  const lang = currentLanguage(ctx);
  const text = BOT_TEXT[lang];
  const description = localizedDescription(product, lang) ? `\n${escapeHtml(localizedDescription(product, lang)!)}` : "";
  const categoryLine = product.category?.name ? `${text.category}: <b>${escapeHtml(product.category.name)}</b>\n` : "";
  const stockText = productQuantityText(product);
  const quickCommand = lang === "en" ? `/mua ${escapeHtml(product.name)} usdt` : `/mua ${escapeHtml(product.name)} vi hoặc /mua ${escapeHtml(product.name)} ck`;
  const caption = `${categoryLine}<b>${escapeHtml(productIcon(product))} ${escapeHtml(localizedName(product, lang))}</b>${description}\n${text.price}: <b>${localizedPrice(
    product,
    lang
  )}</b>\n${text.stock}: ${escapeHtml(stockText)}\n\n${text.quickChat}: ${quickCommand}`;
  const keyboard =
    lang === "en"
      ? Markup.inlineKeyboard([
          [Markup.button.callback(text.buyUsdt, `buy:${product.id}`)],
          [Markup.button.callback(text.back, "catalog")]
        ])
      : Markup.inlineKeyboard([
          [Markup.button.callback(text.buyWallet, `buy_wallet:${product.id}`)],
          [Markup.button.callback(text.bankQr, `buy_bank:${product.id}`)],
          [Markup.button.callback(text.buyUsdt, `buy_usdt:${product.id}`)],
          [Markup.button.callback(text.back, "catalog")]
        ]);

  await renderScreen(ctx, caption, keyboard);
}

async function showQuantitySelection(ctx: Context, productId: string, quantity: number, preferredMethod?: PaymentMethod) {
  await upsertUser(ctx);
  const lang = currentLanguage(ctx);
  const text = BOT_TEXT[lang];
  const normalizedMethod = lang === "en" && !preferredMethod ? "usdt" : preferredMethod;
  const product = await api.get<ProductDetail>(`/bot/products/${productId}`);
  const available = productAvailableQuantity(product);
  if (available === 0) {
    await renderScreen(
      ctx,
      `${escapeHtml(productIcon(product))} <b>${escapeHtml(localizedName(product, lang))}</b>\n\n${text.outOfStock}`,
      Markup.inlineKeyboard([[Markup.button.callback(text.back, `prod:${product.id}`)]])
    );
    return;
  }

  const safeQuantity = clampQuantity(quantity, product);
  const stockLine = available === null ? `${text.stock}: ${text.unlimited}` : `${text.stock}: ${available}`;
  const nextHint =
    normalizedMethod === "wallet"
      ? text.quantityWalletNext
      : normalizedMethod === "bank"
        ? text.quantityBankNext
        : normalizedMethod === "usdt"
          ? text.quantityUsdtNext
          : text.quantityChoosePayment;

  setPendingQuantity(ctx, product.id, normalizedMethod);

  await renderScreen(
    ctx,
    [
      `<b>${escapeHtml(productIcon(product))} ${escapeHtml(localizedName(product, lang))}</b>`,
      localizedDescription(product, lang) ? escapeHtml(localizedDescription(product, lang)!) : "",
      `${text.price}: <b>${localizedPrice(product, lang)}</b>`,
      stockLine,
      "",
      text.quantityPrompt,
      `${text.quantityExample}`,
      nextHint,
      "",
      `${text.selectedQty}: <b>${safeQuantity}</b>`,
      `${text.total}: <b>${localizedTotal(product, safeQuantity, lang)}</b>`
    ]
      .filter(Boolean)
      .join("\n"),
    Markup.inlineKeyboard([[Markup.button.callback(text.back, `prod:${product.id}`)]])
  );
}

async function handlePendingQuantityText(ctx: Context, rawText: string) {
  const pending = getPendingQuantity(ctx);
  if (!pending) return false;

  const lang = currentLanguage(ctx);
  const text = BOT_TEXT[lang];
  const quantity = parseQuantityInput(rawText);
  if (!quantity) {
    await ctx.reply(text.quantityInvalid, Markup.inlineKeyboard([[Markup.button.callback(text.back, `prod:${pending.productId}`)]]));
    return true;
  }

  const product = await api.get<ProductDetail>(`/bot/products/${pending.productId}`);
  const available = productAvailableQuantity(product);
  if (available === 0) {
    clearPendingQuantity(ctx);
    await renderScreen(
      ctx,
      `${escapeHtml(productIcon(product))} <b>${escapeHtml(localizedName(product, lang))}</b>\n\n${text.outOfStock}`,
      Markup.inlineKeyboard([[Markup.button.callback(text.back, `prod:${product.id}`)]])
    );
    return true;
  }

  const safeQuantity = clampQuantity(quantity, product);
  clearPendingQuantity(ctx);

  const method = lang === "en" ? "usdt" : pending.preferredMethod;
  if (method === "wallet") {
    await purchaseWithWallet(ctx, product.id, safeQuantity);
    return true;
  }
  if (method === "bank") {
    await createBankOrderQr(ctx, product.id, safeQuantity);
    return true;
  }
  if (method === "usdt") {
    await createUsdtOrder(ctx, product.id, safeQuantity);
    return true;
  }

  await showPaymentMethodSelection(ctx, product, safeQuantity);
  return true;
}

async function showPaymentMethodSelection(ctx: Context, product: ProductDetail, quantity: number) {
  const lang = currentLanguage(ctx);
  const text = BOT_TEXT[lang];
  await renderScreen(
    ctx,
    [
      `<b>${escapeHtml(productIcon(product))} ${escapeHtml(localizedName(product, lang))}</b>`,
      `${text.selectedQty}: <b>${quantity}</b>`,
      `${text.total}: <b>${localizedTotal(product, quantity, lang)}</b>`,
      "",
      text.quantityChoosePayment
    ].join("\n"),
    Markup.inlineKeyboard([
      ...(lang === "vi"
        ? [
            [
              Markup.button.callback(text.buyWallet, `pay_wallet:${product.id}:${quantity}`),
              Markup.button.callback(text.bankQr, `pay_bank:${product.id}:${quantity}`)
            ]
          ]
        : []),
      [Markup.button.callback(text.buyUsdt, `pay_usdt:${product.id}:${quantity}`)],
      [Markup.button.callback(text.back, `prod:${product.id}`)]
    ])
  );
}

async function showProductByCommand(ctx: Context) {
  const lang = currentLanguage(ctx);
  const reference = getCommandArgs(ctx).join(" ").trim();
  if (!reference) return showCatalog(ctx);

  await upsertUser(ctx);
  const product = await findProductByReference(reference);
  if (!product) {
    await ctx.reply(`${BOT_TEXT[lang].notFoundPrefix} "${reference}". ${BOT_TEXT[lang].useCatalog}`, mainKeyboard(lang));
    return;
  }
  await showProductDetail(ctx, product);
}

async function purchaseByCommand(ctx: Context) {
  const lang = currentLanguage(ctx);
  const args = getCommandArgs(ctx);
  const parsed = parsePurchaseArgs(args);
  if (!parsed.productReference) {
    await ctx.reply(BOT_TEXT[lang].missingProduct, mainKeyboard(lang));
    return;
  }

  await upsertUser(ctx);
  const product = await findProductByReference(parsed.productReference);
  if (!product) {
    await ctx.reply(`${BOT_TEXT[lang].notFoundPrefix} "${parsed.productReference}". ${BOT_TEXT[lang].useCatalog}`, mainKeyboard(lang));
    return;
  }

  const method = parsed.method ?? (lang === "en" ? "usdt" : undefined);
  await showQuantitySelection(ctx, product.id, 1, method);
}

async function topupByCommand(ctx: Context) {
  const [amountText] = getCommandArgs(ctx);
  if (!amountText) return showTopup(ctx);

  const amount = parseVndAmount(amountText);
  if (!amount) {
    await ctx.reply(BOT_TEXT[currentLanguage(ctx)].minTopupError, mainKeyboard(currentLanguage(ctx)));
    return;
  }

  await createTopupQr(ctx, amount);
}

async function createTopupQr(ctx: Context, amount: number) {
  await upsertUser(ctx);
  const lang = currentLanguage(ctx);
  const result = await api.post<PaymentResponse>("/bot/topups", {
    telegramId: String(ctx.from!.id),
    amount
  });
  await sendQr(ctx, result.payment.id, result.qrImageUrl, buildQrCaption(BOT_TEXT[lang].topupTitle, result.code, amount, result.expiresAt, lang), lang);
}

async function purchaseWithWallet(ctx: Context, productId: string, quantity = 1) {
  await upsertUser(ctx);
  const lang = currentLanguage(ctx);
  const result = await api.post<WalletPurchaseResponse>("/bot/orders/wallet", {
    telegramId: String(ctx.from!.id),
    productId,
    quantity
  });
  await renderFinalDelivery(
    ctx,
    `${BOT_TEXT[lang].paidSuccess}\n${BOT_TEXT[lang].balanceAfter}: <b>${formatVnd(
      result.balanceAfter
    )}</b>\n\n${BOT_TEXT[lang].yourGoods}:\n<pre>${escapeHtml(result.deliveryText)}</pre>`
  );
}

async function createBankOrderQr(ctx: Context, productId: string, quantity = 1) {
  await upsertUser(ctx);
  const lang = currentLanguage(ctx);
  const result = await api.post<PaymentResponse>("/bot/orders/bank", {
    telegramId: String(ctx.from!.id),
    productId,
    quantity
  });
  await sendQr(ctx, result.payment.id, result.qrImageUrl, buildQrCaption(BOT_TEXT[lang].orderTitle, result.code, result.amount, result.expiresAt, lang), lang);
}

async function createUsdtOrder(ctx: Context, productId: string, quantity = 1) {
  await upsertUser(ctx);
  const lang = currentLanguage(ctx);
  const text = BOT_TEXT[lang];
  const result = await api.post<PaymentResponse>("/bot/orders/usdt", {
    telegramId: String(ctx.from!.id),
    productId,
    quantity
  });
  const amount = formatUsdt(result.cryptoAmount);
  const caption = [
    "USDT Cryptomus",
    `${text.total}: <b>${amount} USDT</b>`,
    result.network ? `${text.network}: <b>${escapeHtml(cryptoNetworkLabel(result.network))}</b>` : null,
    result.address ? `Wallet: <code>${escapeHtml(result.address)}</code>` : null,
    `Order: <code>${escapeHtml(result.code)}</code>`,
    result.checkoutUrl ? `${text.checkout}: ${escapeHtml(result.checkoutUrl)}` : null,
    `${text.expires}: ${new Date(result.expiresAt).toLocaleString(lang === "vi" ? "vi-VN" : "en-US")}`,
    text.copyWarning,
    lang === "en" ? "The system will process automatically after Cryptomus confirms." : "Hệ thống sẽ tự xử lý sau khi Cryptomus xác nhận."
  ]
    .filter(Boolean)
    .join("\n");
  if (result.qrImageUrl) {
    await sendQr(ctx, result.payment.id, result.qrImageUrl, caption, lang);
    return;
  }
  await renderScreen(ctx, caption, mainKeyboard(lang));
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

async function sendQr(ctx: Context, paymentId: string, qrImageUrl: string, caption: string, language: BotLanguage = "vi") {
  let buffer: Buffer;
  try {
    buffer = await fetchQrImage(qrImageUrl);
  } catch (error) {
    console.error("Could not fetch payment QR image:", error);
    await renderScreen(ctx, `${caption}\n\n${BOT_TEXT[language].qrFallback}`, mainKeyboard(language));
    return;
  }
  const messageId = isCallbackContext(ctx) ? await editCurrentMedia(ctx, buffer, caption) : await sendQrPhoto(ctx, buffer, caption);
  if (!messageId) {
    await editCurrentCaption(
      ctx,
      `${caption}\n\n${language === "en" ? "Could not replace the menu with the QR image. Send the command again to create a new invoice." : "Không thể đổi menu cũ sang ảnh QR. Gửi lại bằng cú pháp /nap số_tiền hoặc /mua sản_phẩm ck để tạo QR mới."}`,
      mainKeyboard(language)
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
  if (!image.ok) throw new Error(`Không tải được ảnh QR. HTTP ${image.status}`);

  const contentType = image.headers.get("content-type") ?? "";
  if (!contentType.includes("image")) {
    throw new Error(`Không tải được ảnh QR. Server trả về ${contentType || "unknown content type"}.`);
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

function buildQrCaption(title: string, code: string, amount: number, expiresAt: string, language: BotLanguage = "vi") {
  const text = BOT_TEXT[language];
  return `${title}\n${text.total}: <b>${formatVnd(amount)}</b>\n${text.bankContent}: <code>${escapeHtml(code)}</code>\n${text.expires}: ${new Date(
    expiresAt
  ).toLocaleString(language === "vi" ? "vi-VN" : "en-US")}\n${text.autoProcess}`;
}

function buildCatalogText(products: ProductSummary[], language: BotLanguage) {
  const text = BOT_TEXT[language];
  if (!products.length) return text.noProducts;

  const productLines = products.slice(0, CATALOG_TEXT_LIMIT).map((product, index) => {
    const category = product.category?.name ? ` - ${escapeHtml(singleLine(product.category.name))}` : "";
    return `${index + 1}. ${escapeHtml(productStateIcon(product))} ${escapeHtml(singleLine(localizedName(product, language)))} - ${localizedPrice(
      product,
      language
    )} - 📦 ${productQuantityText(product, language)}${category}`;
  });
  const moreLine = products.length > CATALOG_TEXT_LIMIT ? `\n\n${language === "vi" ? "Còn" : "There are"} ${products.length - CATALOG_TEXT_LIMIT} ${text.moreProducts}` : "";

  return [
    text.chooseProduct,
    text.viewProduct,
    text.buyWalletSyntax,
    text.buyBankSyntax,
    text.buyUsdtSyntax,
    "",
    productLines.join("\n") + moreLine
  ].join("\n");
}

function productQuantityText(product: ProductSummary | ProductDetail, language: BotLanguage = "vi") {
  const quantity = productAvailableQuantity(product);
  return quantity === null ? BOT_TEXT[language].unlimited : String(quantity);
}

function productButtonLabel(product: ProductSummary, index: number, language: BotLanguage) {
  return `${index + 1}. ${productStateIcon(product)} ${localizedName(product, language)} - ${localizedPrice(product, language)} | 📦 ${productQuantityText(product, language)}`;
}

function productStateIcon(product: ProductSummary | ProductDetail) {
  const quantity = productAvailableQuantity(product);
  if (quantity === 0) return "❌";
  return productIcon(product);
}

function productIcon(product: ProductSummary | ProductDetail) {
  return product.buttonIcon?.trim() || "🛍️";
}

function pendingQuantityKey(ctx: Context) {
  return ctx.from?.id ?? null;
}

function setPendingQuantity(ctx: Context, productId: string, preferredMethod?: PaymentMethod) {
  const key = pendingQuantityKey(ctx);
  if (!key) return;
  pendingQuantities.set(key, {
    productId,
    preferredMethod,
    createdAt: Date.now()
  });
}

function getPendingQuantity(ctx: Context) {
  const key = pendingQuantityKey(ctx);
  if (!key) return null;
  const pending = pendingQuantities.get(key);
  if (!pending) return null;
  if (Date.now() - pending.createdAt > 10 * 60 * 1000) {
    pendingQuantities.delete(key);
    return null;
  }
  return pending;
}

function clearPendingQuantity(ctx: Context) {
  const key = pendingQuantityKey(ctx);
  if (key) pendingQuantities.delete(key);
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

function cryptoNetworkLabel(network: string) {
  const normalized = network.trim().toUpperCase();
  const labels: Record<string, string> = {
    TRON: "TRON / TRC20",
    BSC: "BSC / BEP20",
    ETH: "Ethereum / ERC20",
    POLYGON: "Polygon",
    ARBITRUM: "Arbitrum",
    TON: "TON",
    SOL: "Solana",
    AVALANCHE: "Avalanche"
  };
  return labels[normalized] ?? normalized;
}

function quantityKeyboard(product: ProductDetail, quantity: number, preferredMethod?: PaymentMethod, language: BotLanguage = "vi") {
  const text = BOT_TEXT[language];
  const previousQuantity = clampQuantity(quantity - 1, product);
  const nextQuantity = clampQuantity(quantity + 1, product);
  const quickQuantities = [1, 2, 5, 10]
    .map((value) => clampQuantity(value, product))
    .filter((value, index, values) => values.indexOf(value) === index && value !== quantity);
  const paymentRows =
    preferredMethod === "wallet"
      ? [
          [Markup.button.callback(`${text.confirmWallet} - ${quantity}`, `pay_wallet:${product.id}:${quantity}`)],
          ...(language === "vi" ? [[Markup.button.callback(text.switchBank, `pay_bank:${product.id}:${quantity}`)]] : []),
          [Markup.button.callback(text.buyUsdt, `pay_usdt:${product.id}:${quantity}`)]
        ]
      : preferredMethod === "bank"
        ? [
            [Markup.button.callback(`${text.createBankQr} - ${quantity}`, `pay_bank:${product.id}:${quantity}`)],
            [Markup.button.callback(text.switchWallet, `pay_wallet:${product.id}:${quantity}`)],
            [Markup.button.callback(text.buyUsdt, `pay_usdt:${product.id}:${quantity}`)]
          ]
        : preferredMethod === "usdt"
          ? [
              [Markup.button.callback(`${text.createUsdtInvoice} - ${quantity}`, `pay_usdt:${product.id}:${quantity}`)],
              ...(language === "vi"
                ? [[Markup.button.callback(text.switchWallet, `pay_wallet:${product.id}:${quantity}`), Markup.button.callback(text.switchBank, `pay_bank:${product.id}:${quantity}`)]]
                : [])
            ]
          : language === "en"
            ? [
                [Markup.button.callback(`${text.createUsdtInvoice} - ${quantity}`, `pay_usdt:${product.id}:${quantity}`)]
              ]
            : [
                [
                  Markup.button.callback(text.buyWallet, `pay_wallet:${product.id}:${quantity}`),
                  Markup.button.callback(text.bankQr, `pay_bank:${product.id}:${quantity}`)
                ],
                [Markup.button.callback(text.buyUsdt, `pay_usdt:${product.id}:${quantity}`)]
              ];

  return Markup.inlineKeyboard([
    [
      Markup.button.callback("-", `qty:${product.id}:${previousQuantity}`),
      Markup.button.callback(`${language === "vi" ? "SL" : "Qty"}: ${quantity}`, "noop"),
      Markup.button.callback("+", `qty:${product.id}:${nextQuantity}`)
    ],
    ...(quickQuantities.length ? [quickQuantities.map((value) => Markup.button.callback(String(value), `qty:${product.id}:${value}`))] : []),
    ...paymentRows,
    [Markup.button.callback(text.back, `prod:${product.id}`)]
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
  if (["usdt", "crypto", "cryptomus"].includes(input)) return "usdt" as const;
  return null;
}

function parseQuantityInput(input: string) {
  const normalized = input.trim().replace(/\s/g, "");
  if (!/^\d+$/.test(normalized)) return null;
  const quantity = Number(normalized);
  return Number.isSafeInteger(quantity) && quantity > 0 ? quantity : null;
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
