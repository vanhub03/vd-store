import { BadRequestException, Injectable, Logger, NotFoundException } from "@nestjs/common";
import crypto from "node:crypto";
import bcrypt from "bcryptjs";
import {
  CustomerRole,
  InventoryStatus,
  ManualOrderStatus,
  OrderStatus,
  PaymentKind,
  PaymentMethod,
  PaymentStatus,
  Prisma,
  ProductDeliveryType,
  ProductStatus,
  WalletEntryType
} from "@prisma/client";
import { PrismaService } from "../prisma.service";
import { DIRECT_ORDER_PREFIX, generatePaymentCode, TOPUP_PREFIX } from "./payment-codes";
import { assertPositiveVnd, formatVnd } from "./money";
import { BroadcastService } from "./broadcast.service";
import { TelegramNotifyService } from "./telegram-notify.service";

export type BotUserInput = {
  telegramId: string;
  username?: string;
  firstName?: string;
  lastName?: string;
  languageCode?: string;
};

export type ProductInput = {
  categoryId?: string | null;
  name: string;
  nameEn?: string | null;
  slug?: string;
  description?: string | null;
  descriptionEn?: string | null;
  imageUrl?: string | null;
  buttonIcon?: string | null;
  price?: number;
  botPrice?: number;
  webPrice?: number;
  usdtPrice?: number | string | null;
  collaboratorDiscountPercent?: number;
  showInBot?: boolean;
  showInWeb?: boolean;
  status?: ProductStatus;
  deliveryType: ProductDeliveryType;
  sharedContent?: string | null;
  sharedFilePath?: string | null;
  manualInstructions?: string | null;
  manualStock?: number;
};

export type VoucherInput = {
  code?: string;
  discountPercent: number;
  maxDiscountAmount?: number | null;
  maxDiscountUsdt?: number | string | null;
  active?: boolean;
  firstOrderOnly?: boolean;
  allowCollaboratorStacking?: boolean;
  maxUses?: number | null;
  startsAt?: string | Date | null;
  expiresAt?: string | Date | null;
};

export type VoucherClaim = {
  ipHash: string | null;
  fingerprintHash: string | null;
};

export type CartOrderItemInput = {
  productId: string;
  quantity: number;
};

type SalesChannel = "bot" | "web";
type VoucherQuote = {
  code: string | null;
  voucherId: string | null;
  discountPercent: number;
  subtotalAmount: number;
  collaboratorDiscountAmount: number;
  voucherBaseAmount: number;
  voucherDiscountAmount: number;
  discountAmount: number;
  totalAmount: number;
  firstOrderOnly: boolean;
  expiresAt: Date | null;
  maxUses: number | null;
  maxDiscountAmount: number | null;
  maxDiscountUsdt: number | null;
  claimIpHash: string | null;
  claimFingerprintHash: string | null;
};

type PricingSummary = {
  subtotalAmount: number;
  collaboratorDiscountAmount: number;
  collaboratorSubtotal: number;
};

const ORDER_TRANSACTION_OPTIONS = {
  isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
  maxWait: 10_000,
  timeout: 30_000
};
const FIRST_ORDER_VOUCHER_CODE = "FIRST20";
const FIRST_ORDER_VOUCHER_DAYS = 30;
const VOUCHER_CODE_PATTERN = /^[A-Z0-9_-]{3,32}$/;

@Injectable()
export class ShopService {
  private readonly logger = new Logger(ShopService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly broadcasts: BroadcastService,
    private readonly telegram: TelegramNotifyService
  ) {}

  async upsertTelegramUser(input: BotUserInput) {
    return this.prisma.telegramUser.upsert({
      where: { telegramId: String(input.telegramId) },
      update: {
        username: input.username,
        firstName: input.firstName,
        lastName: input.lastName,
        languageCode: input.languageCode,
        isBlocked: false
      },
      create: {
        telegramId: String(input.telegramId),
        username: input.username,
        firstName: input.firstName,
        lastName: input.lastName,
        languageCode: input.languageCode
      }
    });
  }

  async getCatalog(channel: SalesChannel = "bot", customerRole: CustomerRole = CustomerRole.CUSTOMER) {
    const loadCatalog = async () => {
      const categories = await this.prisma.category.findMany({
        where: { active: true },
        orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
        include: {
          products: {
            where: productVisibilityWhere(channel),
            orderBy: { createdAt: "desc" },
            include: {
              _count: {
                select: {
                  inventoryItems: { where: { status: InventoryStatus.AVAILABLE } }
                }
              }
            }
          }
        }
      });

      const uncategorized = await this.prisma.product.findMany({
        where: { categoryId: null, ...productVisibilityWhere(channel) },
        orderBy: { createdAt: "desc" },
        include: {
          _count: {
            select: {
              inventoryItems: { where: { status: InventoryStatus.AVAILABLE } }
            }
          }
        }
      });

      return {
        categories: categories.map((category) => ({
          ...category,
            products: category.products.map((product) => applyChannelPrice(product, channel, customerRole))
        })),
        uncategorized: uncategorized.map((product) => applyChannelPrice(product, channel, customerRole))
      };
    };
    return typeof this.prisma.withConnectionRetry === "function" ? this.prisma.withConnectionRetry(loadCatalog, `getCatalog:${channel}`) : loadCatalog();
  }

  async getProduct(productId: string, channel: SalesChannel = "bot", customerRole: CustomerRole = CustomerRole.CUSTOMER) {
    const product = await this.prisma.product.findUnique({
      where: { id: productId },
      include: {
        category: true,
        _count: {
          select: {
            inventoryItems: { where: { status: InventoryStatus.AVAILABLE } }
          }
        }
      }
    });
    if (!product || !isVisibleForChannel(product, channel)) {
      throw new NotFoundException("Không tìm thấy sản phẩm.");
    }
    return applyChannelPrice(product, channel, customerRole);
  }

  async getWalletBalanceByTelegramId(telegramId: string) {
    const user = await this.prisma.telegramUser.findUnique({ where: { telegramId: String(telegramId) } });
    if (!user) return 0;
    return this.getWalletBalance(user.id);
  }

  async getWalletBalance(userId: string, tx: Prisma.TransactionClient | PrismaService = this.prisma) {
    const aggregate = await tx.walletLedgerEntry.aggregate({
      where: { userId },
      _sum: { amount: true }
    });
    return aggregate._sum.amount ?? 0;
  }

  async createTopup(telegramId: string, amount: number) {
    assertPositiveVnd(amount);
    const user = await this.requireTelegramUser(telegramId);
    const code = await this.createUniqueCode(TOPUP_PREFIX);
    const expiresAt = minutesFromNow(10);
    const qrImageUrl = this.buildVietQrImageUrl(amount, code);

    const payment = await this.prisma.payment.create({
      data: {
        code,
        kind: PaymentKind.TOPUP,
        status: PaymentStatus.PENDING,
        amount,
        expectedAmount: amount,
        userId: user.id,
        expiresAt,
        qrImageUrl,
        qrPayload: code
      }
    });

    return { payment, code, amount, expiresAt, qrImageUrl };
  }

  async previewVoucher(telegramId: string, productId: string, quantity = 1, voucherCode?: string | null, channel: SalesChannel = "web", voucherClaim?: VoucherClaim | null) {
    if (!Number.isInteger(quantity) || quantity <= 0) {
      throw new BadRequestException("Số lượng không hợp lệ.");
    }
    const user = await this.requireTelegramUser(telegramId);
    const product = await this.getActiveProduct(productId, channel);
    await this.ensurePurchasable(product, quantity);
    const line = priceOrderLine(product, quantity, channel, user.role);
    const quote = await this.quoteVoucher(this.prisma, user, summarizePricing([line]), voucherCode, voucherClaim);
    return publicVoucherQuote(quote);
  }

  async previewCartVoucher(telegramId: string, items: CartOrderItemInput[], voucherCode?: string | null, channel: SalesChannel = "web", voucherClaim?: VoucherClaim | null) {
    const cartItems = normalizeCartItems(items);
    return this.prisma.$transaction(async (tx) => {
      const user = await tx.telegramUser.findUnique({ where: { telegramId: String(telegramId) } });
      if (!user) throw new NotFoundException("User chưa đăng ký.");
      assertActiveUser(user);
      const lines = await this.prepareCartLines(tx, cartItems, channel, user);
      const quote = await this.quoteVoucher(tx, user, summarizePricing(lines), voucherCode, voucherClaim);
      return publicVoucherQuote(quote);
    }, ORDER_TRANSACTION_OPTIONS);
  }

  async createBankOrder(
    telegramId: string,
    productId: string,
    quantity = 1,
    channel: SalesChannel = "bot",
    voucherCode?: string | null,
    voucherClaim?: VoucherClaim | null
  ) {
    if (!Number.isInteger(quantity) || quantity <= 0) {
      throw new BadRequestException("Số lượng không hợp lệ.");
    }

    return this.prisma.$transaction(
      async (tx) => {
        const user = await tx.telegramUser.findUnique({ where: { telegramId: String(telegramId) } });
        if (!user) throw new NotFoundException("User chÆ°a Ä‘Äƒng kÃ½ bot.");

        assertActiveUser(user);
        const product = await tx.product.findUnique({ where: { id: productId } });
        if (!product || !isVisibleForChannel(product, channel)) {
          throw new NotFoundException("KhÃ´ng tÃ¬m tháº¥y sáº£n pháº©m.");
        }
        await this.ensurePurchasable(product, quantity, tx);

        const line = priceOrderLine(product, quantity, channel, user.role);
        const unitPrice = line.unitPrice;
        const quote = await this.quoteVoucher(tx, user, summarizePricing([line]), voucherCode, voucherClaim);
        const code = await this.createUniqueCode(DIRECT_ORDER_PREFIX, tx);
        const expiresAt = minutesFromNow(10);
        const qrImageUrl = this.buildVietQrImageUrl(quote.totalAmount, code);

        const order = await tx.order.create({
          data: {
            code,
            userId: user.id,
            productId: product.id,
            quantity,
            unitPrice,
            subtotalAmount: quote.subtotalAmount,
            discountAmount: quote.discountAmount,
            collaboratorDiscountPercent: line.collaboratorDiscountPercent,
            collaboratorDiscountAmount: line.collaboratorDiscountAmount,
            voucherDiscountAmount: quote.voucherDiscountAmount,
            customerRoleSnapshot: user.role,
            totalAmount: quote.totalAmount,
            voucherId: quote.voucherId,
            voucherCode: quote.code,
            status: OrderStatus.PENDING_PAYMENT,
            paymentMethod: PaymentMethod.BANK_TRANSFER,
            expiresAt,
            payments: {
              create: {
                code,
                kind: PaymentKind.DIRECT_ORDER,
                status: PaymentStatus.PENDING,
                amount: quote.totalAmount,
                expectedAmount: quote.totalAmount,
                userId: user.id,
                expiresAt,
                qrImageUrl,
                qrPayload: code
              }
            }
          },
          include: { payments: true, product: true }
        });

        await this.redeemVoucher(tx, quote, user.id, order.id);
        return { order, payment: order.payments[0], code, amount: quote.totalAmount, expiresAt, qrImageUrl, voucher: publicVoucherQuote(quote) };
      },
      ORDER_TRANSACTION_OPTIONS
    );
  }

  async createCryptomusOrder(
    telegramId: string,
    productId: string,
    quantity = 1,
    channel: SalesChannel = "bot",
    voucherCode?: string | null,
    voucherClaim?: VoucherClaim | null
  ) {
    if (!Number.isInteger(quantity) || quantity <= 0) {
      throw new BadRequestException("So luong khong hop le.");
    }

    const created = await this.prisma.$transaction(
      async (tx) => {
        const user = await tx.telegramUser.findUnique({ where: { telegramId: String(telegramId) } });
        if (!user) throw new NotFoundException("User chÆ°a Ä‘Äƒng kÃ½ bot.");

        assertActiveUser(user);
        const product = await tx.product.findUnique({ where: { id: productId } });
        if (!product || !isVisibleForChannel(product, channel)) {
          throw new NotFoundException("KhÃ´ng tÃ¬m tháº¥y sáº£n pháº©m.");
        }
        await this.ensurePurchasable(product, quantity, tx);
        const unitCryptoAmount = decimalNumber(product.usdtPrice);
        if (!unitCryptoAmount || unitCryptoAmount <= 0) {
          throw new BadRequestException("San pham chua cau hinh gia USDT.");
        }

        const line = priceOrderLine(product, quantity, channel, user.role);
        const unitPrice = line.unitPrice;
        const quote = await this.quoteVoucher(tx, user, summarizePricing([line]), voucherCode, voucherClaim);
        const code = await this.createUniqueCode("USDT", tx);
        const collaboratorCryptoAmount = unitCryptoAmount * quantity * (1 - line.collaboratorDiscountPercent / 100);
        const cryptoAmount = discountedCryptoAmount(collaboratorCryptoAmount, quote);
        const expiresAt = minutesFromNow(10);
        const order = await tx.order.create({
          data: {
            code,
            userId: user.id,
            productId: product.id,
            quantity,
            unitPrice,
            subtotalAmount: quote.subtotalAmount,
            discountAmount: quote.discountAmount,
            collaboratorDiscountPercent: line.collaboratorDiscountPercent,
            collaboratorDiscountAmount: line.collaboratorDiscountAmount,
            voucherDiscountAmount: quote.voucherDiscountAmount,
            customerRoleSnapshot: user.role,
            totalAmount: quote.totalAmount,
            voucherId: quote.voucherId,
            voucherCode: quote.code,
            status: OrderStatus.PENDING_PAYMENT,
            paymentMethod: PaymentMethod.CRYPTOMUS,
            expiresAt,
            payments: {
              create: {
                code,
                kind: PaymentKind.DIRECT_ORDER,
                status: PaymentStatus.PENDING,
                amount: quote.totalAmount,
                expectedAmount: quote.totalAmount,
                userId: user.id,
                expiresAt,
                qrPayload: code,
                provider: "cryptomus",
                cryptoCurrency: "USDT",
                cryptoAmount: new Prisma.Decimal(cryptoAmount)
              }
            }
          },
          include: { payments: true, product: true }
        });

        await this.redeemVoucher(tx, quote, user.id, order.id);
        return { order, payment: order.payments[0], code, amount: quote.totalAmount, cryptoAmount, expiresAt, product, voucher: publicVoucherQuote(quote) };
      },
      ORDER_TRANSACTION_OPTIONS
    );

    const payment = created.payment;
    let cryptomus: Awaited<ReturnType<ShopService["createCryptomusInvoice"]>>;
    try {
      cryptomus = await this.createCryptomusInvoice({
        code: created.code,
        productName: created.product.nameEn?.trim() || created.product.name,
        amount: created.cryptoAmount,
        expiresAt: created.expiresAt
      });
    } catch (error) {
      await this.prisma.$transaction(async (tx) => {
        await this.releaseVoucherForOrder(tx, created.order.id);
        await tx.payment.update({ where: { id: payment.id }, data: { status: PaymentStatus.FAILED } });
        await tx.order.update({ where: { id: created.order.id }, data: { status: OrderStatus.CANCELLED } });
      });
      throw error;
    }

    const updatedPayment = await this.prisma.payment.update({
      where: { id: payment.id },
      data: {
        providerPaymentId: cryptomus.providerPaymentId,
        checkoutUrl: cryptomus.checkoutUrl,
        deeplink: cryptomus.deeplink,
        qrImageUrl: cryptomus.qrImageUrl,
        qrPayload: cryptomus.address ?? cryptomus.checkoutUrl ?? created.code,
        providerPayload: cryptomus.rawPayload as Prisma.InputJsonValue
      }
    });

    return {
      order: created.order,
      payment: updatedPayment,
      code: created.code,
      amount: created.amount,
      cryptoCurrency: "USDT",
      cryptoAmount: created.cryptoAmount,
      expiresAt: created.expiresAt,
      qrImageUrl: updatedPayment.qrImageUrl,
      checkoutUrl: updatedPayment.checkoutUrl,
      deeplink: updatedPayment.deeplink,
      network: cryptomus.network,
      address: cryptomus.address,
      voucher: created.voucher
    };
  }

  async purchaseWithWallet(
    telegramId: string,
    productId: string,
    quantity = 1,
    channel: SalesChannel = "bot",
    voucherCode?: string | null,
    voucherClaim?: VoucherClaim | null
  ) {
    if (!Number.isInteger(quantity) || quantity <= 0) {
      throw new BadRequestException("Số lượng không hợp lệ.");
    }

    const result = await this.prisma.$transaction(
      async (tx) => {
        const user = await tx.telegramUser.findUnique({ where: { telegramId: String(telegramId) } });
        if (!user) throw new NotFoundException("User chưa đăng ký bot.");

        assertActiveUser(user);
        const product = await tx.product.findUnique({ where: { id: productId } });
        if (!product || !isVisibleForChannel(product, channel)) {
          throw new NotFoundException("Không tìm thấy sản phẩm.");
        }
        await this.ensurePurchasable(product, quantity, tx);

        const line = priceOrderLine(product, quantity, channel, user.role);
        const unitPrice = line.unitPrice;
        const quote = await this.quoteVoucher(tx, user, summarizePricing([line]), voucherCode, voucherClaim);
        const balance = await this.getWalletBalance(user.id, tx);
        if (balance < quote.totalAmount) {
          throw new BadRequestException("Số dư không đủ.");
        }

        const code = await this.createUniqueCode("VI", tx);
        const order = await tx.order.create({
          data: {
            code,
            userId: user.id,
            productId: product.id,
            quantity,
            unitPrice,
            subtotalAmount: quote.subtotalAmount,
            discountAmount: quote.discountAmount,
            collaboratorDiscountPercent: line.collaboratorDiscountPercent,
            collaboratorDiscountAmount: line.collaboratorDiscountAmount,
            voucherDiscountAmount: quote.voucherDiscountAmount,
            customerRoleSnapshot: user.role,
            totalAmount: quote.totalAmount,
            voucherId: quote.voucherId,
            voucherCode: quote.code,
            status: OrderStatus.PAID,
            paymentMethod: PaymentMethod.WALLET
          }
        });

        const payment = await tx.payment.create({
          data: {
            code,
            kind: PaymentKind.WALLET_PURCHASE,
            status: PaymentStatus.SUCCEEDED,
            amount: quote.totalAmount,
            expectedAmount: quote.totalAmount,
            userId: user.id,
            orderId: order.id
          }
        });
        await this.redeemVoucher(tx, quote, user.id, order.id);

        await tx.walletLedgerEntry.create({
          data: {
            userId: user.id,
            amount: -quote.totalAmount,
            type: WalletEntryType.PURCHASE,
            referencePaymentId: payment.id,
            referenceOrderId: order.id,
            note: `Mua ${product.name}`
          }
        });

        const deliveryText = await this.fulfillOrderItems(tx, order.id, product, quantity);
        const fulfilledOrder = await tx.order.update({
          where: { id: order.id },
          data: {
            status: OrderStatus.FULFILLED,
            deliveryText,
            fulfilledAt: new Date()
          }
        });

        return { order: fulfilledOrder, payment, deliveryText, balanceAfter: balance - quote.totalAmount, voucher: publicVoucherQuote(quote) };
      },
      ORDER_TRANSACTION_OPTIONS
    );
    await this.notifyManualOrderIfNeeded(result.order.id);
    return result;
  }

  async purchaseCartWithWallet(
    telegramId: string,
    items: CartOrderItemInput[],
    channel: SalesChannel = "web",
    voucherCode?: string | null,
    voucherClaim?: VoucherClaim | null
  ) {
    const cartItems = normalizeCartItems(items);
    const result = await this.prisma.$transaction(
      async (tx) => {
        const user = await tx.telegramUser.findUnique({ where: { telegramId: String(telegramId) } });
        if (!user) throw new NotFoundException("User chưa đăng ký.");
        assertActiveUser(user);
        const lines = await this.prepareCartLines(tx, cartItems, channel, user);
        const quote = await this.quoteVoucher(tx, user, summarizePricing(lines), voucherCode, voucherClaim);
        const pricedLines = allocateCartQuote(lines, quote);
        const balance = await this.getWalletBalance(user.id, tx);
        if (balance < quote.totalAmount) throw new BadRequestException("Số dư không đủ.");

        const checkoutGroupId = crypto.randomUUID();
        const paymentCode = await this.createUniqueCode("VI", tx);
        const orders = [];
        for (let index = 0; index < pricedLines.length; index += 1) {
          const line = pricedLines[index];
          const order = await tx.order.create({
            data: {
              code: index === 0 ? paymentCode : await this.createUniqueCode("VI", tx),
              checkoutGroupId,
              userId: user.id,
              productId: line.product.id,
              quantity: line.quantity,
              unitPrice: line.unitPrice,
              subtotalAmount: line.subtotalAmount,
              discountAmount: line.discountAmount,
              collaboratorDiscountPercent: line.collaboratorDiscountPercent,
              collaboratorDiscountAmount: line.collaboratorDiscountAmount,
              voucherDiscountAmount: line.voucherDiscountAmount,
              customerRoleSnapshot: user.role,
              totalAmount: line.totalAmount,
              voucherId: index === 0 ? quote.voucherId : null,
              voucherCode: index === 0 ? quote.code : null,
              status: OrderStatus.PAID,
              paymentMethod: PaymentMethod.WALLET
            }
          });
          orders.push({ order, line });
        }

        const firstOrder = orders[0].order;
        const payment = await tx.payment.create({
          data: {
            code: paymentCode,
            kind: PaymentKind.WALLET_PURCHASE,
            status: PaymentStatus.SUCCEEDED,
            amount: quote.totalAmount,
            expectedAmount: quote.totalAmount,
            userId: user.id,
            orderId: firstOrder.id
          }
        });
        await this.redeemVoucher(tx, quote, user.id, firstOrder.id);
        await tx.walletLedgerEntry.create({
          data: {
            userId: user.id,
            amount: -quote.totalAmount,
            type: WalletEntryType.PURCHASE,
            referencePaymentId: payment.id,
            referenceOrderId: firstOrder.id,
            note: `Mua ${orders.length} sản phẩm trong giỏ hàng`
          }
        });

        const fulfilledOrders = [];
        for (const entry of orders) {
          const deliveryText = await this.fulfillOrderItems(tx, entry.order.id, entry.line.product, entry.line.quantity);
          fulfilledOrders.push(
            await tx.order.update({
              where: { id: entry.order.id },
              data: { status: OrderStatus.FULFILLED, deliveryText, fulfilledAt: new Date() },
              include: { product: true }
            })
          );
        }
        return {
          order: fulfilledOrders[0],
          orders: fulfilledOrders,
          payment,
          deliveryText: formatCartDelivery(fulfilledOrders),
          balanceAfter: balance - quote.totalAmount,
          voucher: publicVoucherQuote(quote)
        };
      },
      ORDER_TRANSACTION_OPTIONS
    );
    await Promise.all(result.orders.map((order) => this.notifyManualOrderIfNeeded(order.id)));
    return result;
  }

  async createCartBankOrder(
    telegramId: string,
    items: CartOrderItemInput[],
    channel: SalesChannel = "web",
    voucherCode?: string | null,
    voucherClaim?: VoucherClaim | null
  ) {
    const cartItems = normalizeCartItems(items);
    return this.prisma.$transaction(
      async (tx) => {
        const user = await tx.telegramUser.findUnique({ where: { telegramId: String(telegramId) } });
        if (!user) throw new NotFoundException("User chưa đăng ký.");
        assertActiveUser(user);
        const lines = await this.prepareCartLines(tx, cartItems, channel, user);
        const quote = await this.quoteVoucher(tx, user, summarizePricing(lines), voucherCode, voucherClaim);
        const pricedLines = allocateCartQuote(lines, quote);
        const checkoutGroupId = crypto.randomUUID();
        const code = await this.createUniqueCode(DIRECT_ORDER_PREFIX, tx);
        const expiresAt = minutesFromNow(10);
        const qrImageUrl = this.buildVietQrImageUrl(quote.totalAmount, code);
        const orders = [];
        for (let index = 0; index < pricedLines.length; index += 1) {
          const line = pricedLines[index];
          orders.push(
            await tx.order.create({
              data: {
                code: index === 0 ? code : await this.createUniqueCode(DIRECT_ORDER_PREFIX, tx),
                checkoutGroupId,
                userId: user.id,
                productId: line.product.id,
                quantity: line.quantity,
                unitPrice: line.unitPrice,
                subtotalAmount: line.subtotalAmount,
                discountAmount: line.discountAmount,
                collaboratorDiscountPercent: line.collaboratorDiscountPercent,
                collaboratorDiscountAmount: line.collaboratorDiscountAmount,
                voucherDiscountAmount: line.voucherDiscountAmount,
                customerRoleSnapshot: user.role,
                totalAmount: line.totalAmount,
                voucherId: index === 0 ? quote.voucherId : null,
                voucherCode: index === 0 ? quote.code : null,
                status: OrderStatus.PENDING_PAYMENT,
                paymentMethod: PaymentMethod.BANK_TRANSFER,
                expiresAt
              },
              include: { product: true }
            })
          );
        }
        const payment = await tx.payment.create({
          data: {
            code,
            kind: PaymentKind.DIRECT_ORDER,
            status: PaymentStatus.PENDING,
            amount: quote.totalAmount,
            expectedAmount: quote.totalAmount,
            userId: user.id,
            orderId: orders[0].id,
            expiresAt,
            qrImageUrl,
            qrPayload: code
          }
        });
        await this.redeemVoucher(tx, quote, user.id, orders[0].id);
        return { orders, order: orders[0], payment, code, amount: quote.totalAmount, expiresAt, qrImageUrl, voucher: publicVoucherQuote(quote) };
      },
      ORDER_TRANSACTION_OPTIONS
    );
  }

  async createCartCryptomusOrder(
    telegramId: string,
    items: CartOrderItemInput[],
    channel: SalesChannel = "web",
    voucherCode?: string | null,
    voucherClaim?: VoucherClaim | null
  ) {
    const cartItems = normalizeCartItems(items);
    const created = await this.prisma.$transaction(
      async (tx) => {
        const user = await tx.telegramUser.findUnique({ where: { telegramId: String(telegramId) } });
        if (!user) throw new NotFoundException("User chưa đăng ký.");
        assertActiveUser(user);
        const lines = await this.prepareCartLines(tx, cartItems, channel, user);
        for (const line of lines) {
          if (!decimalNumber(line.product.usdtPrice)) throw new BadRequestException(`${line.product.name} chưa có giá USDT.`);
        }
        const quote = await this.quoteVoucher(tx, user, summarizePricing(lines), voucherCode, voucherClaim);
        const pricedLines = allocateCartQuote(lines, quote);
        const checkoutGroupId = crypto.randomUUID();
        const code = await this.createUniqueCode("USDT", tx);
        const expiresAt = minutesFromNow(10);
        const collaboratorCryptoAmount = lines.reduce(
          (sum, line) => sum + Number(line.product.usdtPrice) * line.quantity * (1 - line.collaboratorDiscountPercent / 100),
          0
        );
        const cryptoAmount = discountedCryptoAmount(collaboratorCryptoAmount, quote);
        const orders = [];
        for (let index = 0; index < pricedLines.length; index += 1) {
          const line = pricedLines[index];
          orders.push(
            await tx.order.create({
              data: {
                code: index === 0 ? code : await this.createUniqueCode("USDT", tx),
                checkoutGroupId,
                userId: user.id,
                productId: line.product.id,
                quantity: line.quantity,
                unitPrice: line.unitPrice,
                subtotalAmount: line.subtotalAmount,
                discountAmount: line.discountAmount,
                collaboratorDiscountPercent: line.collaboratorDiscountPercent,
                collaboratorDiscountAmount: line.collaboratorDiscountAmount,
                voucherDiscountAmount: line.voucherDiscountAmount,
                customerRoleSnapshot: user.role,
                totalAmount: line.totalAmount,
                voucherId: index === 0 ? quote.voucherId : null,
                voucherCode: index === 0 ? quote.code : null,
                status: OrderStatus.PENDING_PAYMENT,
                paymentMethod: PaymentMethod.CRYPTOMUS,
                expiresAt
              },
              include: { product: true }
            })
          );
        }
        const payment = await tx.payment.create({
          data: {
            code,
            kind: PaymentKind.DIRECT_ORDER,
            status: PaymentStatus.PENDING,
            amount: quote.totalAmount,
            expectedAmount: quote.totalAmount,
            userId: user.id,
            orderId: orders[0].id,
            expiresAt,
            qrPayload: code,
            provider: "cryptomus",
            cryptoCurrency: "USDT",
            cryptoAmount: new Prisma.Decimal(cryptoAmount)
          }
        });
        await this.redeemVoucher(tx, quote, user.id, orders[0].id);
        return { orders, order: orders[0], payment, code, amount: quote.totalAmount, cryptoAmount, expiresAt, voucher: publicVoucherQuote(quote) };
      },
      ORDER_TRANSACTION_OPTIONS
    );

    let cryptomus: Awaited<ReturnType<ShopService["createCryptomusInvoice"]>>;
    try {
      cryptomus = await this.createCryptomusInvoice({
        code: created.code,
        productName: `${created.orders.length} products`,
        amount: created.cryptoAmount,
        expiresAt: created.expiresAt
      });
    } catch (error) {
      await this.prisma.$transaction(async (tx) => {
        await this.releaseVoucherForOrder(tx, created.order.id);
        await tx.payment.update({ where: { id: created.payment.id }, data: { status: PaymentStatus.FAILED } });
        await tx.order.updateMany({ where: { checkoutGroupId: created.order.checkoutGroupId }, data: { status: OrderStatus.CANCELLED } });
      });
      throw error;
    }

    const payment = await this.prisma.payment.update({
      where: { id: created.payment.id },
      data: {
        providerPaymentId: cryptomus.providerPaymentId,
        checkoutUrl: cryptomus.checkoutUrl,
        deeplink: cryptomus.deeplink,
        qrImageUrl: cryptomus.qrImageUrl,
        qrPayload: cryptomus.address ?? cryptomus.checkoutUrl ?? created.code,
        providerPayload: cryptomus.rawPayload as Prisma.InputJsonValue
      }
    });
    return {
      ...created,
      payment,
      cryptoCurrency: "USDT",
      qrImageUrl: payment.qrImageUrl,
      checkoutUrl: payment.checkoutUrl,
      deeplink: payment.deeplink,
      network: cryptomus.network,
      address: cryptomus.address
    };
  }

  async fulfillDirectOrder(paymentId: string) {
    return this.prisma.$transaction(
      async (tx) => {
        const payment = await tx.payment.findUnique({
          where: { id: paymentId },
          include: {
            order: { include: { product: true, user: true } },
            user: true
          }
        });

        if (!payment || payment.kind !== PaymentKind.DIRECT_ORDER || !payment.order) {
          throw new NotFoundException("Không tìm thấy payment đơn hàng.");
        }

        if (payment.status !== PaymentStatus.PENDING && payment.status !== PaymentStatus.EXPIRED) {
          return { outcome: "already_processed" as const, payment };
        }

        const groupOrders = payment.order.checkoutGroupId
          ? await tx.order.findMany({
              where: { checkoutGroupId: payment.order.checkoutGroupId },
              orderBy: { createdAt: "asc" },
              include: { product: true, user: true }
            })
          : [payment.order];
        const groupOrderIds = groupOrders.map((order) => order.id);

        const now = new Date();
        if ((payment.expiresAt && payment.expiresAt < now) || (payment.order.expiresAt && payment.order.expiresAt < now)) {
          await this.creditPaymentToWallet(
            tx,
            payment.id,
            payment.userId!,
            payment.amount,
            "Thanh toán đơn quá hạn được cộng vào ví.",
            WalletEntryType.DIRECT_PAYMENT_CREDIT
          );
          const updatedPayment = await tx.payment.update({
            where: { id: payment.id },
            data: { status: PaymentStatus.CREDITED_TO_WALLET }
          });
          await this.releaseVoucherForOrder(tx, payment.order.id);
          if (groupOrderIds.length === 1) {
            await tx.order.update({ where: { id: payment.order.id }, data: { status: OrderStatus.CREDITED_TO_WALLET } });
          } else {
            await tx.order.updateMany({ where: { id: { in: groupOrderIds } }, data: { status: OrderStatus.CREDITED_TO_WALLET } });
          }
          return { outcome: "credited_late_payment" as const, payment: updatedPayment, user: payment.order.user };
        }

        try {
          for (const order of groupOrders) {
            await this.ensurePurchasable(order.product, order.quantity, tx);
          }
          if (groupOrders.length === 1) {
            const deliveryText = await this.fulfillOrderItems(tx, payment.order.id, payment.order.product, payment.order.quantity);
            const updatedPayment = await tx.payment.update({
              where: { id: payment.id },
              data: { status: PaymentStatus.SUCCEEDED }
            });
            const order = await tx.order.update({
              where: { id: payment.order.id },
              data: { status: OrderStatus.FULFILLED, deliveryText, fulfilledAt: new Date() }
            });
            return { outcome: "fulfilled" as const, payment: updatedPayment, order, orders: [{ ...order, product: payment.order.product }], deliveryText, user: payment.order.user };
          }
          const updatedPayment = await tx.payment.update({
            where: { id: payment.id },
            data: { status: PaymentStatus.SUCCEEDED }
          });
          const fulfilledOrders = [];
          for (const order of groupOrders) {
            const deliveryText = await this.fulfillOrderItems(tx, order.id, order.product, order.quantity);
            fulfilledOrders.push(
              await tx.order.update({
                where: { id: order.id },
                data: { status: OrderStatus.FULFILLED, deliveryText, fulfilledAt: new Date() },
                include: { product: true }
              })
            );
          }
          const deliveryText = formatCartDelivery(fulfilledOrders);
          return { outcome: "fulfilled" as const, payment: updatedPayment, order: fulfilledOrders[0], orders: fulfilledOrders, deliveryText, user: payment.order.user };
        } catch (error) {
          await this.creditPaymentToWallet(
            tx,
            payment.id,
            payment.userId!,
            payment.amount,
            "Hàng đã hết, tiền được cộng vào ví.",
            WalletEntryType.DIRECT_PAYMENT_CREDIT
          );
          const updatedPayment = await tx.payment.update({
            where: { id: payment.id },
            data: { status: PaymentStatus.CREDITED_TO_WALLET }
          });
          await this.releaseVoucherForOrder(tx, payment.order.id);
          if (groupOrderIds.length === 1) {
            await tx.order.update({ where: { id: payment.order.id }, data: { status: OrderStatus.CREDITED_TO_WALLET } });
          } else {
            await tx.order.updateMany({ where: { id: { in: groupOrderIds } }, data: { status: OrderStatus.CREDITED_TO_WALLET } });
          }
          return { outcome: "credited_out_of_stock" as const, payment: updatedPayment, user: payment.order.user, error };
        }
      },
      ORDER_TRANSACTION_OPTIONS
    );
  }

  async creditTopup(paymentId: string) {
    return this.prisma.$transaction(
      async (tx) => {
        const payment = await tx.payment.findUnique({
          where: { id: paymentId },
          include: { user: true }
        });
        if (!payment || payment.kind !== PaymentKind.TOPUP || !payment.userId || !payment.user) {
          throw new NotFoundException("Không tìm thấy payment nạp tiền.");
        }
        if (payment.status !== PaymentStatus.PENDING && payment.status !== PaymentStatus.EXPIRED) {
          return { outcome: "already_processed" as const, payment, user: payment.user };
        }
        await this.creditPaymentToWallet(tx, payment.id, payment.userId, payment.amount, `Nạp tiền ${payment.code}`, WalletEntryType.TOPUP);
        const updatedPayment = await tx.payment.update({
          where: { id: payment.id },
          data: { status: PaymentStatus.SUCCEEDED }
        });
        return { outcome: "credited" as const, payment: updatedPayment, user: payment.user };
      },
      ORDER_TRANSACTION_OPTIONS
    );
  }

  async markPaymentManualReview(paymentId: string, reason: string) {
    const payment = await this.prisma.payment.update({
      where: { id: paymentId },
      data: { status: PaymentStatus.MANUAL_REVIEW }
    });
    if (payment.orderId) {
      const order = await this.prisma.order.findUnique({ where: { id: payment.orderId }, select: { checkoutGroupId: true } });
      await this.prisma.order.updateMany({
        where: order?.checkoutGroupId ? { checkoutGroupId: order.checkoutGroupId } : { id: payment.orderId },
        data: { status: OrderStatus.MANUAL_REVIEW }
      });
    }
    await this.prisma.auditLog.create({
      data: {
        action: "PAYMENT_MANUAL_REVIEW",
        entityType: "Payment",
        entityId: payment.id,
        meta: { reason }
      }
    });
    return payment;
  }

  async recordPaymentTelegramMessage(paymentId: string, telegramChatId: string, telegramMessageId: number) {
    const payment = await this.prisma.payment.update({
      where: { id: paymentId },
      data: { telegramChatId: String(telegramChatId), telegramMessageId }
    });
    if (payment.status !== PaymentStatus.PENDING) {
      await this.telegram.deleteMessage(telegramChatId, telegramMessageId);
    }
    return payment;
  }

  async getHistory(telegramId: string) {
    const user = await this.requireTelegramUser(telegramId);
    const [orders, ledger] = await Promise.all([
      this.prisma.order.findMany({
        where: { userId: user.id },
        orderBy: { createdAt: "desc" },
        take: 10,
        include: { product: true, payments: true }
      }),
      this.prisma.walletLedgerEntry.findMany({
        where: { userId: user.id },
        orderBy: { createdAt: "desc" },
        take: 10
      })
    ]);
    return { orders, ledger };
  }

  async notifyManualOrderIfNeeded(orderId: string) {
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      include: { product: true, user: true }
    });
    if (!order || order.product.deliveryType !== ProductDeliveryType.MANUAL) return;
    const existingAudit = await this.prisma.auditLog.findFirst({
      where: {
        action: "MANUAL_ORDER_NOTIFY",
        entityType: "Order",
        entityId: order.id
      }
    });
    if (existingAudit) return;

    await this.prisma.auditLog.create({
      data: {
        action: "MANUAL_ORDER_NOTIFY",
        entityType: "Order",
        entityId: order.id,
        meta: {
          code: order.code,
          productName: order.product.name,
          quantity: order.quantity,
          totalAmount: order.totalAmount,
          customerLabel: order.user.email ?? order.user.username ?? order.user.telegramId
        }
      }
    });
    await this.telegram.notifyAdminManualOrder({
      code: order.code,
      productName: order.product.name,
      quantity: order.quantity,
      totalAmount: order.totalAmount,
      customerLabel: order.user.email ?? order.user.username ?? order.user.telegramId,
      deliveryText: order.deliveryText
    });
  }

  async listAdminUsers() {
    const users = await this.prisma.telegramUser.findMany({
      orderBy: { createdAt: "desc" },
      take: 200
    });
    const balances = await Promise.all(users.map((user) => this.getWalletBalance(user.id)));
    return users.map((user, index) => ({ ...user, passwordHash: undefined, balance: balances[index] }));
  }

  async listCollaborators(filters?: { search?: string; status?: string; createdFrom?: string; createdTo?: string }) {
    const search = filters?.search?.trim();
    const createdAt: Prisma.DateTimeFilter = {};
    if (filters?.createdFrom) createdAt.gte = new Date(`${filters.createdFrom}T00:00:00+07:00`);
    if (filters?.createdTo) createdAt.lte = new Date(`${filters.createdTo}T23:59:59+07:00`);
    const users = await this.prisma.telegramUser.findMany({
      where: {
        role: CustomerRole.COLLABORATOR,
        ...(filters?.status === "active" ? { isBlocked: false } : filters?.status === "blocked" ? { isBlocked: true } : {}),
        ...(Object.keys(createdAt).length ? { createdAt } : {}),
        ...(search
          ? {
              OR: [
                { email: { contains: search, mode: "insensitive" } },
                { displayName: { contains: search, mode: "insensitive" } },
                { username: { contains: search, mode: "insensitive" } }
              ]
            }
          : {})
      },
      orderBy: { createdAt: "desc" },
      include: {
        orders: {
          orderBy: { createdAt: "desc" },
          take: 5,
          include: { product: { select: { id: true, name: true } } }
        }
      }
    });
    const balances = await Promise.all(users.map((user) => this.getWalletBalance(user.id)));
    return users.map((user, index) => ({ ...user, passwordHash: undefined, balance: balances[index] }));
  }

  async getCollaboratorReport() {
    const [total, active, orderStats, topProducts, recentOrders] = await Promise.all([
      this.prisma.telegramUser.count({ where: { role: CustomerRole.COLLABORATOR } }),
      this.prisma.telegramUser.count({ where: { role: CustomerRole.COLLABORATOR, isBlocked: false } }),
      this.prisma.order.aggregate({
        where: { customerRoleSnapshot: CustomerRole.COLLABORATOR },
        _count: { id: true },
        _sum: { totalAmount: true, collaboratorDiscountAmount: true }
      }),
      this.prisma.order.groupBy({
        by: ["productId"],
        where: { customerRoleSnapshot: CustomerRole.COLLABORATOR },
        _sum: { quantity: true, totalAmount: true },
        orderBy: { _sum: { quantity: "desc" } },
        take: 10
      }),
      this.prisma.order.findMany({
        where: { customerRoleSnapshot: CustomerRole.COLLABORATOR },
        orderBy: { createdAt: "desc" },
        take: 30,
        include: { user: true, product: true }
      })
    ]);
    const products = await this.prisma.product.findMany({
      where: { id: { in: topProducts.map((item) => item.productId) } },
      select: { id: true, name: true }
    });
    const productsById = new Map(products.map((product) => [product.id, product]));
    return {
      total,
      active,
      orderCount: orderStats._count.id,
      revenue: orderStats._sum.totalAmount ?? 0,
      discountGranted: orderStats._sum.collaboratorDiscountAmount ?? 0,
      topProducts: topProducts.map((item) => ({ ...item, product: productsById.get(item.productId) })),
      recentOrders
    };
  }

  async createCollaborator(adminId: string, input: { email: string; displayName?: string; password: string }) {
    const email = input.email.toLowerCase().trim();
    const existing = await this.prisma.telegramUser.findUnique({ where: { email } });
    if (existing) throw new BadRequestException("Email đã được sử dụng.");
    const passwordHash = await bcrypt.hash(input.password, 10);
    const collaborator = await this.prisma.telegramUser.create({
      data: {
        telegramId: `web:${crypto.randomUUID()}`,
        email,
        username: email,
        displayName: input.displayName?.trim() || email.split("@")[0],
        passwordHash,
        role: CustomerRole.COLLABORATOR
      }
    });
    await this.audit(adminId, "COLLABORATOR_CREATE", "TelegramUser", collaborator.id, { email });
    return { ...collaborator, passwordHash: undefined };
  }

  async updateCollaborator(
    adminId: string,
    userId: string,
    input: { role?: CustomerRole; isBlocked?: boolean; password?: string; displayName?: string }
  ) {
    const previous = await this.prisma.telegramUser.findUnique({ where: { id: userId } });
    if (!previous) throw new NotFoundException("Không tìm thấy tài khoản.");
    const data: Prisma.TelegramUserUpdateInput = {};
    if (input.role !== undefined) data.role = input.role;
    if (input.isBlocked !== undefined) data.isBlocked = input.isBlocked;
    if (input.displayName !== undefined) data.displayName = input.displayName.trim() || null;
    if (input.password !== undefined) data.passwordHash = await bcrypt.hash(input.password, 10);
    const updated = await this.prisma.telegramUser.update({ where: { id: userId }, data });
    const auditActions: string[] = [];
    if (input.role !== undefined && input.role !== previous.role) {
      auditActions.push(
        input.role === CustomerRole.COLLABORATOR ? "COLLABORATOR_PROMOTE" : "COLLABORATOR_REVOKE"
      );
    }
    if (input.isBlocked !== undefined && input.isBlocked !== previous.isBlocked) {
      auditActions.push(input.isBlocked ? "COLLABORATOR_LOCK" : "COLLABORATOR_UNLOCK");
    }
    if (input.password !== undefined) auditActions.push("COLLABORATOR_PASSWORD_RESET");
    if (input.displayName !== undefined && updated.displayName !== previous.displayName) {
      auditActions.push("COLLABORATOR_UPDATE");
    }
    if (auditActions.length === 0) auditActions.push("COLLABORATOR_UPDATE");
    const auditMeta = {
      role: input.role,
      isBlocked: input.isBlocked,
      displayNameChanged: input.displayName !== undefined,
      passwordChanged: input.password !== undefined
    };
    await Promise.all(
      auditActions.map((action) => this.audit(adminId, action, "TelegramUser", userId, auditMeta))
    );
    return { ...updated, passwordHash: undefined };
  }

  async adjustWallet(adminId: string, userId: string, amount: number, note?: string) {
    if (!Number.isInteger(amount) || amount === 0) {
      throw new BadRequestException("Số tiền điều chỉnh phải là số nguyên khác 0.");
    }
    return this.prisma.$transaction(async (tx) => {
      const user = await tx.telegramUser.findUnique({ where: { id: userId } });
      if (!user) throw new NotFoundException("Không tìm thấy user.");

      const balance = await this.getWalletBalance(user.id, tx);
      if (balance + amount < 0) {
        throw new BadRequestException("Điều chỉnh làm số dư âm.");
      }

      const entry = await tx.walletLedgerEntry.create({
        data: {
          userId: user.id,
          amount,
          type: WalletEntryType.ADMIN_ADJUSTMENT,
          note: note ?? "Admin điều chỉnh số dư."
        }
      });
      await tx.auditLog.create({
        data: {
          actorAdminId: adminId,
          action: "WALLET_ADJUSTMENT",
          entityType: "TelegramUser",
          entityId: user.id,
          meta: { amount, note }
        }
      });
      return { entry, balanceAfter: balance + amount };
    }, ORDER_TRANSACTION_OPTIONS);
  }

  async listProducts() {
    return this.prisma.product.findMany({
      orderBy: { createdAt: "desc" },
      include: {
        category: true,
        _count: {
          select: {
            inventoryItems: { where: { status: InventoryStatus.AVAILABLE } }
          }
        }
      }
    });
  }

  async createProduct(input: ProductInput, adminId: string) {
    const priceData = normalizeProductPrices(input, true);
    assertCollaboratorDiscount(input.collaboratorDiscountPercent);
    assertNonNegativeStock(input.manualStock);
    const imageUrl = input.imageUrl ?? detectBrandImageUrl(input.name);
    const product = await this.prisma.product.create({
      data: {
        ...input,
        ...priceData,
        imageUrl,
        slug: input.slug ? slugify(input.slug) : slugify(input.name),
        buttonIcon: normalizeProductIcon(input.buttonIcon, input.name),
        manualInstructions: input.manualInstructions?.trim() || defaultManualInstructions()
      } as Prisma.ProductUncheckedCreateInput
    });
    await this.audit(adminId, "PRODUCT_CREATE", "Product", product.id, { name: product.name });
    await this.announceNewProductIfReady(product, adminId);
    return product;
  }

  async updateProduct(productId: string, input: Partial<ProductInput>, adminId: string) {
    const priceData = normalizeProductPrices(input, false);
    assertCollaboratorDiscount(input.collaboratorDiscountPercent);
    assertNonNegativeStock(input.manualStock);
    const previous = await this.prisma.product.findUnique({ where: { id: productId } });
    if (!previous) throw new NotFoundException("Không tìm thấy sản phẩm.");

    const product = await this.prisma.product.update({
      where: { id: productId },
      data: {
        ...input,
        ...priceData,
        slug: input.slug ? slugify(input.slug) : undefined,
        buttonIcon: input.buttonIcon === undefined ? undefined : normalizeProductIcon(input.buttonIcon, input.name),
        manualInstructions: input.manualInstructions === null ? defaultManualInstructions() : input.manualInstructions
      }
    });
    await this.audit(adminId, "PRODUCT_UPDATE", "Product", product.id, input);
    await this.announceManualStockIncrease(previous, product, adminId);
    return product;
  }

  async importInventory(productId: string, lines: string[], adminId: string) {
    const product = await this.prisma.product.findUnique({ where: { id: productId } });
    if (!product) throw new NotFoundException("Không tìm thấy sản phẩm.");

    const cleaned = lines.map((line) => line.trim()).filter(Boolean);
    if (cleaned.length === 0) throw new BadRequestException("Danh sách tồn kho trống.");

    const result = await this.prisma.inventoryItem.createMany({
      data: cleaned.map((content) => ({ productId, content })),
      skipDuplicates: false
    });
    await this.audit(adminId, "INVENTORY_IMPORT", "Product", productId, { count: result.count });
    await this.announceStockItemIncrease(product, result.count, adminId);
    return result;
  }

  async listVouchers() {
    return this.prisma.voucher.findMany({
      orderBy: { createdAt: "desc" },
      take: 200,
      include: {
        createdBy: { select: { id: true, email: true, name: true } },
        _count: { select: { redemptions: true } }
      }
    });
  }

  async createVoucher(input: VoucherInput, adminId: string) {
    const data = normalizeVoucherInput(input, false);
    const voucher = await this.prisma.voucher.create({
      data: {
        ...data,
        code: data.code!,
        discountPercent: data.discountPercent!,
        expiresAt: data.expiresAt!,
        createdByAdminId: adminId
      }
    });
    await this.audit(adminId, "VOUCHER_CREATE", "Voucher", voucher.id, {
      code: voucher.code,
      discountPercent: voucher.discountPercent,
      expiresAt: voucher.expiresAt
    });
    return voucher;
  }

  async updateVoucher(voucherId: string, input: Partial<VoucherInput>, adminId: string) {
    const previous = await this.prisma.voucher.findUnique({ where: { id: voucherId } });
    if (!previous) throw new NotFoundException("Không tìm thấy mã ưu đãi.");
    const data = normalizeVoucherInput(input, true);
    const voucher = await this.prisma.voucher.update({
      where: { id: voucherId },
      data
    });
    await this.audit(adminId, "VOUCHER_UPDATE", "Voucher", voucher.id, {
      code: voucher.code,
      discountPercent: voucher.discountPercent,
      active: voucher.active,
      expiresAt: voucher.expiresAt
    });
    return voucher;
  }

  async listOrders() {
    return this.prisma.order.findMany({
      orderBy: { createdAt: "desc" },
      take: 200,
      include: { user: true, product: true, payments: true, voucher: true }
    });
  }

  async updateManualOrderStatus(adminId: string, orderId: string, status: ManualOrderStatus) {
    if (!["COMPLETED", "CANCELLED"].includes(status)) {
      throw new BadRequestException("Trạng thái xử lý đơn không hợp lệ.");
    }
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      include: { product: true }
    });
    if (!order) throw new NotFoundException("Không tìm thấy đơn hàng.");
    if (order.product.deliveryType !== ProductDeliveryType.MANUAL) {
      throw new BadRequestException("Chỉ đơn liên hệ admin mới có trạng thái theo dõi.");
    }
    const updated = await this.prisma.order.update({
      where: { id: orderId },
      data: { manualStatus: status },
      include: { user: true, product: true }
    });
    await this.audit(adminId, status === "COMPLETED" ? "MANUAL_ORDER_COMPLETE" : "MANUAL_ORDER_CANCEL", "Order", orderId, {
      code: updated.code,
      product: updated.product.name
    });
    return updated;
  }

  async listPayments() {
    return this.prisma.payment.findMany({
      orderBy: { createdAt: "desc" },
      take: 200,
      include: { user: true, order: { include: { product: true } }, bankTransactions: true }
    });
  }

  async getStats() {
    const [users, products, orders, pendingPayments] = await Promise.all([
      this.prisma.telegramUser.count(),
      this.prisma.product.count(),
      this.prisma.order.count(),
      this.prisma.payment.count({ where: { status: PaymentStatus.PENDING } })
    ]);
    const revenue = await this.prisma.payment.aggregate({
      where: { status: PaymentStatus.SUCCEEDED, kind: { in: [PaymentKind.DIRECT_ORDER, PaymentKind.WALLET_PURCHASE] } },
      _sum: { amount: true }
    });
    return {
      users,
      products,
      orders,
      pendingPayments,
      revenue: revenue._sum.amount ?? 0
    };
  }

  async getDashboard() {
    const now = new Date();
    const dailyCutoff = new Date(now.getTime() - 13 * 24 * 60 * 60 * 1000);
    const monthlyCutoff = new Date(now.getTime() - 370 * 24 * 60 * 60 * 1000);
    const saleWhere = {
      status: PaymentStatus.SUCCEEDED,
      kind: { in: [PaymentKind.DIRECT_ORDER, PaymentKind.WALLET_PURCHASE] }
    };

    const [
      stats,
      dailyPayments,
      monthlyPayments,
      walletTotal,
      walletCredits,
      walletDebits,
      topWalletGroups,
      recentWalletEntries,
      manualOrderAlerts
    ] =
      await Promise.all([
        this.getStats(),
        this.prisma.payment.findMany({
          where: { ...saleWhere, createdAt: { gte: dailyCutoff } },
          select: { amount: true, createdAt: true }
        }),
        this.prisma.payment.findMany({
          where: { ...saleWhere, createdAt: { gte: monthlyCutoff } },
          select: { amount: true, createdAt: true }
        }),
        this.prisma.walletLedgerEntry.aggregate({ _sum: { amount: true } }),
        this.prisma.walletLedgerEntry.aggregate({ where: { amount: { gt: 0 } }, _sum: { amount: true } }),
        this.prisma.walletLedgerEntry.aggregate({ where: { amount: { lt: 0 } }, _sum: { amount: true } }),
        this.prisma.walletLedgerEntry.groupBy({
          by: ["userId"],
          _sum: { amount: true }
        }),
        this.prisma.walletLedgerEntry.findMany({
          orderBy: { createdAt: "desc" },
          take: 20,
          include: { user: true }
        }),
        this.prisma.order.findMany({
          where: {
            status: { in: [OrderStatus.PAID, OrderStatus.FULFILLED] },
            manualStatus: ManualOrderStatus.PENDING,
            product: { deliveryType: ProductDeliveryType.MANUAL }
          },
          orderBy: { createdAt: "desc" },
          take: 8,
          include: { user: true, product: true }
        })
      ]);

    const topWallets = topWalletGroups
      .map((group) => ({ userId: group.userId, balance: group._sum.amount ?? 0 }))
      .filter((group) => group.balance !== 0)
      .sort((a, b) => b.balance - a.balance)
      .slice(0, 10);
    const topWalletUsers = await this.prisma.telegramUser.findMany({
      where: { id: { in: topWallets.map((wallet) => wallet.userId) } }
    });
    const usersById = new Map(topWalletUsers.map((user) => [user.id, user]));

    const revenueByDay = buildDailyRevenueSeries(14, dailyPayments);
    const revenueByMonth = buildMonthlyRevenueSeries(12, monthlyPayments);
    const currentDayKey = dayKey(now);
    const currentMonthKey = monthKey(now);

    return {
      ...stats,
      todayRevenue: revenueByDay.find((point) => point.key === currentDayKey)?.revenue ?? 0,
      monthRevenue: revenueByMonth.find((point) => point.key === currentMonthKey)?.revenue ?? 0,
      totalWalletBalance: walletTotal._sum.amount ?? 0,
      totalWalletCredit: walletCredits._sum.amount ?? 0,
      totalWalletDebit: Math.abs(walletDebits._sum.amount ?? 0),
      revenueByDay,
      revenueByMonth,
      topWallets: topWallets.map((wallet) => ({
        balance: wallet.balance,
        user: usersById.get(wallet.userId)
      })),
      recentWalletEntries: recentWalletEntries.map((entry) => ({
        id: entry.id,
        amount: entry.amount,
        type: entry.type,
        note: entry.note,
        createdAt: entry.createdAt,
        user: entry.user
      })),
      manualOrderAlerts: manualOrderAlerts.map((order) => ({
        id: order.id,
        code: order.code,
        quantity: order.quantity,
        totalAmount: order.totalAmount,
        status: order.status,
        manualStatus: order.manualStatus,
        deliveryText: order.deliveryText,
        createdAt: order.createdAt,
        user: order.user,
        product: order.product
      }))
    };
  }

  async expirePendingPayments() {
    const now = new Date();
    const pending = await this.prisma.payment.findMany({
      where: {
        status: PaymentStatus.PENDING,
        expiresAt: { lt: now }
      },
      include: { order: true }
    });

    for (const payment of pending) {
      await this.prisma.$transaction(async (tx) => {
        await tx.payment.update({
          where: { id: payment.id },
          data: { status: PaymentStatus.EXPIRED }
        });
        if (payment.order?.status === OrderStatus.PENDING_PAYMENT) {
          await this.releaseVoucherForOrder(tx, payment.order.id);
          await tx.order.updateMany({
            where: payment.order.checkoutGroupId ? { checkoutGroupId: payment.order.checkoutGroupId } : { id: payment.order.id },
            data: { status: OrderStatus.EXPIRED }
          });
        }
      });
    }
    return pending;
  }

  async releaseVoucherReservation(orderId: string) {
    await this.prisma.$transaction(async (tx) => {
      await this.releaseVoucherForOrder(tx, orderId);
    });
  }

  private async prepareCartLines(
    tx: Prisma.TransactionClient,
    items: CartOrderItemInput[],
    channel: SalesChannel,
    user: { role: CustomerRole }
  ) {
    const products = await tx.product.findMany({
      where: { id: { in: items.map((item) => item.productId) } }
    });
    if (products.length !== items.length) throw new NotFoundException("Một sản phẩm trong giỏ không còn tồn tại.");
    const productMap = new Map(products.map((product) => [product.id, product]));
    const lines = [];
    for (const item of items) {
      const product = productMap.get(item.productId);
      if (!product || !isVisibleForChannel(product, channel)) {
        throw new NotFoundException("Một sản phẩm trong giỏ không còn được bán.");
      }
      await this.ensurePurchasable(product, item.quantity, tx);
      lines.push(priceOrderLine(product, item.quantity, channel, user.role));
    }
    return lines;
  }

  private async quoteVoucher(
    tx: Prisma.TransactionClient | PrismaService,
    user: { id: string; createdAt: Date; role: CustomerRole },
    pricing: PricingSummary,
    voucherCode?: string | null,
    voucherClaim?: VoucherClaim | null
  ): Promise<VoucherQuote> {
    const cleanCode = normalizeVoucherCode(voucherCode);
    if (!cleanCode) {
      return {
        code: null,
        voucherId: null,
        discountPercent: 0,
        subtotalAmount: pricing.subtotalAmount,
        collaboratorDiscountAmount: pricing.collaboratorDiscountAmount,
        voucherBaseAmount: pricing.collaboratorSubtotal,
        voucherDiscountAmount: 0,
        discountAmount: pricing.collaboratorDiscountAmount,
        totalAmount: pricing.collaboratorSubtotal,
        firstOrderOnly: false,
        expiresAt: null,
        maxUses: null,
        maxDiscountAmount: null,
        maxDiscountUsdt: null,
        claimIpHash: null,
        claimFingerprintHash: null
      };
    }

    const voucher = cleanCode === FIRST_ORDER_VOUCHER_CODE ? await this.ensureFirstOrderVoucher(tx) : await tx.voucher.findUnique({ where: { code: cleanCode } });
    if (!voucher || !voucher.active) {
      throw new BadRequestException("Mã ưu đãi không hợp lệ.");
    }
    if (user.role === CustomerRole.COLLABORATOR && !voucher.allowCollaboratorStacking) {
      throw new BadRequestException("Mã ưu đãi này không áp dụng cùng giá cộng tác viên.");
    }

    const now = new Date();
    if (voucher.startsAt > now) {
      throw new BadRequestException("Mã ưu đãi chưa đến thời gian sử dụng.");
    }
    if (voucher.expiresAt < now) {
      throw new BadRequestException("Mã ưu đãi đã hết hạn.");
    }
    if (voucher.maxUses !== null && voucher.usedCount >= voucher.maxUses) {
      throw new BadRequestException("Mã ưu đãi đã hết lượt sử dụng.");
    }

    const existingRedemption = await tx.voucherRedemption.findFirst({
      where: { voucherId: voucher.id, userId: user.id },
      select: { id: true }
    });
    if (existingRedemption) {
      throw new BadRequestException("Bạn đã dùng mã ưu đãi này rồi.");
    }

    if (voucher.firstOrderOnly) {
      if (!voucherClaim?.fingerprintHash && !voucherClaim?.ipHash) {
        throw new BadRequestException("Không xác thực được phiên ưu đãi. Vui lòng thử lại.");
      }
      const reuseFilters: Prisma.VoucherRedemptionWhereInput[] = [];
      if (voucherClaim.fingerprintHash) reuseFilters.push({ claimFingerprintHash: voucherClaim.fingerprintHash });
      if (voucherClaim.ipHash) reuseFilters.push({ claimIpHash: voucherClaim.ipHash });
      const existingClaim = await tx.voucherRedemption.findFirst({
        where: {
          userId: { not: user.id },
          voucher: { firstOrderOnly: true },
          OR: reuseFilters
        },
        select: { id: true }
      });
      if (existingClaim) {
        throw new BadRequestException("Mã ưu đãi đơn đầu đã được dùng trên thiết bị hoặc mạng này.");
      }

      const customerVoucherExpiresAt = new Date(user.createdAt.getTime() + FIRST_ORDER_VOUCHER_DAYS * 24 * 60 * 60 * 1000);
      if (customerVoucherExpiresAt < now) {
        throw new BadRequestException("Mã ưu đãi đơn đầu đã hết hạn.");
      }
      const existingOrder = await tx.order.findFirst({
        where: {
          userId: user.id,
          status: { notIn: [OrderStatus.EXPIRED, OrderStatus.CANCELLED, OrderStatus.CREDITED_TO_WALLET] }
        },
        select: { id: true }
      });
      if (existingOrder) {
        throw new BadRequestException("Mã ưu đãi này chỉ dành cho đơn hàng đầu tiên.");
      }
    }

    const percentageDiscount = Math.floor((pricing.collaboratorSubtotal * voucher.discountPercent) / 100);
    const discountAmount = voucher.maxDiscountAmount === null ? percentageDiscount : Math.min(percentageDiscount, voucher.maxDiscountAmount);
    const totalAmount = Math.max(0, pricing.collaboratorSubtotal - discountAmount);
    if (totalAmount <= 0) {
      throw new BadRequestException("Mã ưu đãi vượt quá giá trị đơn hàng.");
    }

    return {
      code: voucher.code,
      voucherId: voucher.id,
      discountPercent: voucher.discountPercent,
      subtotalAmount: pricing.subtotalAmount,
      collaboratorDiscountAmount: pricing.collaboratorDiscountAmount,
      voucherBaseAmount: pricing.collaboratorSubtotal,
      voucherDiscountAmount: discountAmount,
      discountAmount: pricing.collaboratorDiscountAmount + discountAmount,
      totalAmount,
      firstOrderOnly: voucher.firstOrderOnly,
      expiresAt: voucher.firstOrderOnly ? new Date(user.createdAt.getTime() + FIRST_ORDER_VOUCHER_DAYS * 24 * 60 * 60 * 1000) : voucher.expiresAt,
      maxUses: voucher.maxUses,
      maxDiscountAmount: voucher.maxDiscountAmount,
      maxDiscountUsdt: decimalNumber(voucher.maxDiscountUsdt),
      claimIpHash: voucher.firstOrderOnly ? voucherClaim?.ipHash ?? null : null,
      claimFingerprintHash: voucher.firstOrderOnly ? voucherClaim?.fingerprintHash ?? null : null
    };
  }

  private async redeemVoucher(tx: Prisma.TransactionClient, quote: VoucherQuote, userId: string, orderId: string) {
    if (!quote.voucherId || !quote.code || quote.voucherDiscountAmount <= 0) return;
    const now = new Date();
    const updateWhere =
      quote.maxUses === null
        ? { id: quote.voucherId, active: true, startsAt: { lte: now }, expiresAt: { gte: now } }
        : { id: quote.voucherId, active: true, startsAt: { lte: now }, expiresAt: { gte: now }, usedCount: { lt: quote.maxUses } };
    const updated = await tx.voucher.updateMany({
      where: updateWhere,
      data: { usedCount: { increment: 1 } }
    });
    if (updated.count !== 1) {
      throw new BadRequestException("Mã ưu đãi vừa hết lượt sử dụng.");
    }
    await tx.voucherRedemption.create({
      data: {
        voucherId: quote.voucherId,
        userId,
        orderId,
        subtotalAmount: quote.voucherBaseAmount,
        discountAmount: quote.voucherDiscountAmount,
        totalAmount: quote.totalAmount,
        claimIpHash: quote.claimIpHash,
        claimFingerprintHash: quote.claimFingerprintHash
      }
    });
  }

  private async releaseVoucherForOrder(tx: Prisma.TransactionClient, orderId: string) {
    if (!tx.voucherRedemption || !tx.voucher) return;
    const redemption = await tx.voucherRedemption.findUnique({
      where: { orderId },
      select: { id: true, voucherId: true }
    });
    if (!redemption) return;
    await tx.voucherRedemption.delete({ where: { id: redemption.id } });
    await tx.voucher.updateMany({
      where: { id: redemption.voucherId, usedCount: { gt: 0 } },
      data: { usedCount: { decrement: 1 } }
    });
  }

  private async ensureFirstOrderVoucher(tx: Prisma.TransactionClient | PrismaService) {
    return tx.voucher.upsert({
      where: { code: FIRST_ORDER_VOUCHER_CODE },
      update: {
        discountPercent: 20,
        active: true,
        firstOrderOnly: true,
        allowCollaboratorStacking: false,
        maxDiscountAmount: 50_000,
        maxDiscountUsdt: new Prisma.Decimal(2),
        maxUses: null,
        expiresAt: new Date("2100-01-01T00:00:00.000Z")
      },
      create: {
        code: FIRST_ORDER_VOUCHER_CODE,
        discountPercent: 20,
        active: true,
        firstOrderOnly: true,
        allowCollaboratorStacking: false,
        maxDiscountAmount: 50_000,
        maxDiscountUsdt: new Prisma.Decimal(2),
        maxUses: null,
        expiresAt: new Date("2100-01-01T00:00:00.000Z")
      }
    });
  }

  private async requireTelegramUser(telegramId: string) {
    const user = await this.prisma.telegramUser.findUnique({ where: { telegramId: String(telegramId) } });
    if (!user) throw new NotFoundException("User chưa đăng ký bot.");
    if (user.isBlocked) throw new BadRequestException("Tài khoản đã bị khóa.");
    return user;
  }

  private async getActiveProduct(productId: string, channel: SalesChannel = "bot") {
    const product = await this.prisma.product.findUnique({ where: { id: productId } });
    if (!product || !isVisibleForChannel(product, channel)) {
      throw new NotFoundException("Không tìm thấy sản phẩm.");
    }
    return { ...product, price: channelPrice(product, channel) };
  }

  private async ensurePurchasable(
    product: { id: string; deliveryType: ProductDeliveryType; status: ProductStatus; manualStock?: number | null },
    quantity: number,
    tx: Prisma.TransactionClient | PrismaService = this.prisma
  ) {
    if (product.status !== ProductStatus.ACTIVE) {
      throw new BadRequestException("Sản phẩm đang tạm ẩn.");
    }
    if (product.deliveryType === ProductDeliveryType.STOCK_ITEM) {
      const available = await tx.inventoryItem.count({
        where: { productId: product.id, status: InventoryStatus.AVAILABLE }
      });
      if (available < quantity) {
        throw new BadRequestException("Sản phẩm đã hết hàng.");
      }
    }
    if (product.deliveryType === ProductDeliveryType.MANUAL && (product.manualStock ?? 0) < quantity) {
      throw new BadRequestException("Sáº£n pháº©m Ä‘Ã£ háº¿t hÃ ng.");
    }
  }

  private async fulfillOrderItems(
    tx: Prisma.TransactionClient,
    orderId: string,
    product: {
      id: string;
      name: string;
      deliveryType: ProductDeliveryType;
      sharedContent?: string | null;
      sharedFilePath?: string | null;
      manualInstructions?: string | null;
      manualStock?: number | null;
    },
    quantity: number
  ) {
    if (product.deliveryType === ProductDeliveryType.MANUAL) {
      const updated = await tx.product.updateMany({
        where: { id: product.id, manualStock: { gte: quantity } },
        data: { manualStock: { decrement: quantity } }
      });
      if (updated.count !== 1) {
        throw new BadRequestException("San pham da het hang.");
      }
      return product.manualInstructions || defaultManualInstructions();
    }

    if (product.deliveryType === ProductDeliveryType.SHARED_CONTENT) {
      const chunks = [product.sharedContent, product.sharedFilePath ? `File: ${product.sharedFilePath}` : null].filter(Boolean);
      if (chunks.length === 0) {
        throw new BadRequestException("Sản phẩm chưa có nội dung giao hàng.");
      }
      return chunks.join("\n");
    }

    const items = await tx.inventoryItem.findMany({
      where: { productId: product.id, status: InventoryStatus.AVAILABLE },
      orderBy: { createdAt: "asc" },
      take: quantity
    });
    if (items.length < quantity) {
      throw new BadRequestException("Sản phẩm đã hết hàng.");
    }

    const updated = await tx.inventoryItem.updateMany({
      where: { id: { in: items.map((item) => item.id) }, status: InventoryStatus.AVAILABLE },
      data: {
        status: InventoryStatus.SOLD,
        orderId,
        soldAt: new Date()
      }
    });
    if (updated.count !== quantity) {
      throw new BadRequestException("Tồn kho vừa thay đổi, vui lòng thử lại.");
    }

    return items.map((item) => item.content).join("\n");
  }

  private async creditPaymentToWallet(
    tx: Prisma.TransactionClient,
    paymentId: string,
    userId: string,
    amount: number,
    note: string,
    type: WalletEntryType
  ) {
    const existing = await tx.walletLedgerEntry.findFirst({ where: { referencePaymentId: paymentId } });
    if (existing) return existing;
    return tx.walletLedgerEntry.create({
      data: {
        userId,
        amount,
        type,
        referencePaymentId: paymentId,
        note
      }
    });
  }

  private async createUniqueCode(prefix: string, tx: Prisma.TransactionClient | PrismaService = this.prisma) {
    for (let attempt = 0; attempt < 10; attempt += 1) {
      const code = generatePaymentCode(prefix);
      const [payment, order] = await Promise.all([
        tx.payment.findUnique({ where: { code } }),
        tx.order.findUnique({ where: { code } })
      ]);
      if (!payment && !order) return code;
    }
    throw new Error("Không tạo được mã thanh toán duy nhất.");
  }

  private buildVietQrImageUrl(amount: number, code: string) {
    const bankCode = (process.env.VIETQR_BANK_CODE?.trim() || "TPB").toUpperCase();
    const accountNumber = (process.env.VIETQR_ACCOUNT_NUMBER || process.env.SEPAY_ACCOUNT_NUMBER || "03219071601").trim();
    const accountName = (process.env.VIETQR_ACCOUNT_NAME || "VANH DAO").trim();
    const template = process.env.VIETQR_TEMPLATE ?? "compact2";
    const baseUrl = (process.env.VIETQR_IMAGE_BASE_URL ?? "https://img.vietqr.io/image").replace(/\/+$/, "");

    if (!bankCode || !accountNumber) {
      throw new BadRequestException("Thiếu cấu hình VietQR: cần VIETQR_BANK_CODE và VIETQR_ACCOUNT_NUMBER.");
    }

    const params = new URLSearchParams({
      amount: String(amount),
      addInfo: code,
      accountName
    });
    return `${baseUrl}/${encodeURIComponent(bankCode)}-${encodeURIComponent(accountNumber)}-${encodeURIComponent(template)}.png?${params.toString()}`;
  }

  private async createCryptomusInvoice(input: { code: string; productName: string; amount: string; expiresAt: Date }) {
    const merchantId = process.env.CRYPTOMUS_MERCHANT_ID?.trim();
    const paymentApiKey = process.env.CRYPTOMUS_PAYMENT_API_KEY?.trim();
    if (!merchantId || !paymentApiKey) {
      throw new BadRequestException("Chua cau hinh CRYPTOMUS_MERCHANT_ID va CRYPTOMUS_PAYMENT_API_KEY.");
    }

    const baseUrl = (process.env.CRYPTOMUS_API_BASE_URL ?? "https://api.cryptomus.com").replace(/\/+$/, "");
    const network = (process.env.CRYPTOMUS_NETWORK ?? "tron").trim().toLowerCase();
    const body = {
      amount: input.amount,
      currency: "USDT",
      order_id: input.code,
      network,
      lifetime: Math.max(300, Math.floor((input.expiresAt.getTime() - Date.now()) / 1000)),
      url_return: process.env.CRYPTOMUS_RETURN_URL ?? process.env.WEB_PUBLIC_URL ?? "https://vanhdao.io.vn",
      url_success: process.env.CRYPTOMUS_SUCCESS_URL ?? process.env.WEB_PUBLIC_URL ?? "https://vanhdao.io.vn",
      url_callback: process.env.CRYPTOMUS_WEBHOOK_URL ?? `${process.env.API_BASE_URL ?? ""}/webhooks/cryptomus`,
      additional_data: input.productName.slice(0, 255)
    };
    const bodyText = JSON.stringify(body);
    const signature = cryptomusSign(bodyText, paymentApiKey);
    const response = await fetch(`${baseUrl}/v1/payment`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        merchant: merchantId,
        sign: signature
      },
      body: bodyText
    });
    const result = (await response.json()) as {
      state?: number;
      message?: string;
      errors?: unknown;
      result?: {
        uuid?: string;
        url?: string;
        address?: string | null;
        network?: string | null;
        expired_at?: number;
      };
    };
    if (!response.ok || result.state !== 0 || !result.result) {
      throw new BadRequestException(`Cryptomus create invoice failed: ${result.message ?? JSON.stringify(result.errors ?? response.status)}`);
    }
    const qrContent = result.result.address || result.result.url;
    return {
      providerPaymentId: result.result.uuid,
      checkoutUrl: result.result.url,
      deeplink: result.result.url,
      qrImageUrl: qrContent ? buildQrCodeUrl(qrContent) : undefined,
      address: result.result.address ?? null,
      network: result.result.network ?? network,
      rawPayload: result
    };
  }

  private async audit(adminId: string, action: string, entityType: string, entityId: string, meta?: unknown) {
    await this.prisma.auditLog.create({
      data: {
        actorAdminId: adminId,
        action,
        entityType,
        entityId,
        meta: meta === undefined ? undefined : (meta as Prisma.InputJsonValue)
      }
    });
  }

  private async announceNewProductIfReady(product: {
    id: string;
    name: string;
    description?: string | null;
    price: number;
    botPrice?: number | null;
    webPrice?: number | null;
    showInBot?: boolean | null;
    status: ProductStatus;
    deliveryType: ProductDeliveryType;
    manualStock?: number | null;
  }, adminId: string) {
    if (product.status !== ProductStatus.ACTIVE || product.showInBot === false) return;
    if (product.deliveryType === ProductDeliveryType.STOCK_ITEM) return;

    if (product.deliveryType === ProductDeliveryType.MANUAL) {
      const stock = product.manualStock ?? 0;
      if (stock <= 0) return;
      await this.queueNewStockBroadcast(product, stock, stock, adminId);
      return;
    }

    await this.queueNewStockBroadcast(product, null, null, adminId);
  }

  private async announceManualStockIncrease(
    previous: {
      name: string;
      manualStock?: number | null;
      status: ProductStatus;
      deliveryType: ProductDeliveryType;
    },
    product: {
      id: string;
      name: string;
      description?: string | null;
      price: number;
      botPrice?: number | null;
      webPrice?: number | null;
      showInBot?: boolean | null;
      status: ProductStatus;
      deliveryType: ProductDeliveryType;
      manualStock?: number | null;
    },
    adminId: string
  ) {
    if (product.status !== ProductStatus.ACTIVE || product.showInBot === false || product.deliveryType !== ProductDeliveryType.MANUAL) return;
    const previousStock = previous.deliveryType === ProductDeliveryType.MANUAL ? previous.manualStock ?? 0 : 0;
    const currentStock = product.manualStock ?? 0;
    const addedCount = currentStock - previousStock;
    if (addedCount <= 0) return;
    await this.queueNewStockBroadcast(product, addedCount, currentStock, adminId);
  }

  private async announceStockItemIncrease(
    product: {
      id: string;
      name: string;
      description?: string | null;
      price: number;
      botPrice?: number | null;
      webPrice?: number | null;
      showInBot?: boolean | null;
      status: ProductStatus;
      deliveryType: ProductDeliveryType;
    },
    addedCount: number,
    adminId: string
  ) {
    if (product.status !== ProductStatus.ACTIVE || product.showInBot === false || product.deliveryType !== ProductDeliveryType.STOCK_ITEM || addedCount <= 0) return;
    const availableStock = await this.prisma.inventoryItem.count({
      where: { productId: product.id, status: InventoryStatus.AVAILABLE }
    });
    await this.queueNewStockBroadcast(product, addedCount, availableStock, adminId);
  }

  private async queueNewStockBroadcast(
    product: {
      name: string;
      description?: string | null;
      price: number;
      botPrice?: number | null;
      webPrice?: number | null;
      deliveryType: ProductDeliveryType;
    },
    addedCount: number | null,
    stock: number | null,
    adminId: string
  ) {
    const title = `Hàng mới: ${product.name}`;
    const message = buildNewStockBroadcastMessage(product, addedCount, stock);
    try {
      await this.broadcasts.createSystemBroadcast(title, message, adminId);
    } catch (error) {
      this.logger.warn(`Could not queue new stock broadcast for ${product.name}: ${(error as Error).message}`);
    }
  }
}

function minutesFromNow(minutes: number) {
  return new Date(Date.now() + minutes * 60_000);
}

function monthFromNow() {
  const date = new Date();
  date.setMonth(date.getMonth() + 1);
  return date;
}

function normalizeVoucherCode(input?: string | null) {
  const code = input?.trim().toUpperCase().replace(/\s+/g, "") ?? "";
  if (!code) return null;
  if (!VOUCHER_CODE_PATTERN.test(code)) {
    throw new BadRequestException("Mã ưu đãi chỉ gồm chữ, số, gạch ngang hoặc gạch dưới, từ 3 đến 32 ký tự.");
  }
  return code;
}

function normalizeVoucherInput(input: Partial<VoucherInput>, partial: boolean) {
  const data: {
    code?: string;
    discountPercent?: number;
    maxDiscountAmount?: number | null;
    maxDiscountUsdt?: Prisma.Decimal | null;
    active?: boolean;
    firstOrderOnly?: boolean;
    allowCollaboratorStacking?: boolean;
    maxUses?: number | null;
    startsAt?: Date;
    expiresAt?: Date;
  } = {};

  const hasDiscount = input.discountPercent !== undefined;
  if (hasDiscount || !partial) {
    const percent = Number(input.discountPercent);
    if (!Number.isInteger(percent) || percent < 1 || percent > 90) {
      throw new BadRequestException("Phần trăm giảm phải từ 1 đến 90.");
    }
    data.discountPercent = percent;
    if (!partial) {
      data.code = normalizeVoucherCode(input.code) ?? `VD${percent}-${crypto.randomBytes(3).toString("hex").toUpperCase()}`;
    }
  }

  if (input.code !== undefined && partial) {
    const code = normalizeVoucherCode(input.code);
    if (!code) throw new BadRequestException("Mã ưu đãi không được để trống.");
    data.code = code;
  }

  if (input.active !== undefined) data.active = Boolean(input.active);
  if (input.firstOrderOnly !== undefined) data.firstOrderOnly = Boolean(input.firstOrderOnly);
  if (input.allowCollaboratorStacking !== undefined) data.allowCollaboratorStacking = Boolean(input.allowCollaboratorStacking);
  if (input.maxUses !== undefined) {
    if (input.maxUses === null) {
      data.maxUses = null;
    } else {
      const maxUses = Number(input.maxUses);
      if (!Number.isInteger(maxUses) || maxUses < 1) {
        throw new BadRequestException("Số lượt dùng phải là số nguyên lớn hơn 0.");
      }
      data.maxUses = maxUses;
    }
  }

  if (input.maxDiscountAmount !== undefined) {
    if (input.maxDiscountAmount === null) {
      data.maxDiscountAmount = null;
    } else {
      const maxDiscountAmount = Number(input.maxDiscountAmount);
      if (!Number.isInteger(maxDiscountAmount) || maxDiscountAmount < 1) {
        throw new BadRequestException("Số tiền giảm tối đa phải là số nguyên lớn hơn 0.");
      }
      data.maxDiscountAmount = maxDiscountAmount;
    }
  }

  if (input.maxDiscountUsdt !== undefined) {
    data.maxDiscountUsdt = input.maxDiscountUsdt === null ? null : normalizeUsdtPrice(input.maxDiscountUsdt);
  }

  if (input.startsAt !== undefined && input.startsAt !== null) {
    data.startsAt = parseVoucherDate(input.startsAt, "Ngày bắt đầu không hợp lệ.");
  } else if (!partial) {
    data.startsAt = new Date();
  }

  if (input.expiresAt !== undefined && input.expiresAt !== null) {
    data.expiresAt = parseVoucherDate(input.expiresAt, "Ngày hết hạn không hợp lệ.");
  } else if (!partial) {
    data.expiresAt = monthFromNow();
  }

  if (data.startsAt && data.expiresAt && data.expiresAt <= data.startsAt) {
    throw new BadRequestException("Ngày hết hạn phải sau ngày bắt đầu.");
  }

  return data;
}

function parseVoucherDate(value: string | Date, message: string) {
  const date = value instanceof Date ? value : new Date(/^\d{4}-\d{2}-\d{2}$/.test(value) ? `${value}T23:59:59+07:00` : value);
  if (Number.isNaN(date.getTime())) {
    throw new BadRequestException(message);
  }
  return date;
}

function publicVoucherQuote(quote: VoucherQuote) {
  return {
    code: quote.code,
    discountPercent: quote.discountPercent,
    subtotalAmount: quote.subtotalAmount,
    collaboratorDiscountAmount: quote.collaboratorDiscountAmount,
    voucherDiscountAmount: quote.voucherDiscountAmount,
    discountAmount: quote.discountAmount,
    totalAmount: quote.totalAmount,
    maxDiscountAmount: quote.maxDiscountAmount,
    maxDiscountUsdt: quote.maxDiscountUsdt,
    firstOrderOnly: quote.firstOrderOnly,
    expiresAt: quote.expiresAt
  };
}

function normalizeCartItems(items: CartOrderItemInput[]) {
  if (!Array.isArray(items) || items.length < 1 || items.length > 20) {
    throw new BadRequestException("Giỏ hàng phải có từ 1 đến 20 sản phẩm.");
  }
  const quantities = new Map<string, number>();
  for (const item of items) {
    const productId = item?.productId?.trim();
    const quantity = Number(item?.quantity);
    if (!productId || !Number.isInteger(quantity) || quantity < 1 || quantity > 999) {
      throw new BadRequestException("Sản phẩm hoặc số lượng trong giỏ không hợp lệ.");
    }
    quantities.set(productId, (quantities.get(productId) ?? 0) + quantity);
  }
  return [...quantities.entries()].map(([productId, quantity]) => ({ productId, quantity }));
}

function allocateCartQuote<T extends { subtotalAmount: number }>(lines: T[], quote: VoucherQuote) {
  let allocatedVoucherDiscount = 0;
  return lines.map((line, index) => {
    const collaboratorDiscountAmount = "collaboratorDiscountAmount" in line ? Number(line.collaboratorDiscountAmount) : 0;
    const voucherBaseAmount = line.subtotalAmount - collaboratorDiscountAmount;
    const voucherDiscountAmount =
      quote.voucherDiscountAmount <= 0
        ? 0
        : index === lines.length - 1
        ? quote.voucherDiscountAmount - allocatedVoucherDiscount
        : Math.min(voucherBaseAmount, Math.floor((voucherBaseAmount / quote.voucherBaseAmount) * quote.voucherDiscountAmount));
    allocatedVoucherDiscount += voucherDiscountAmount;
    return {
      ...line,
      voucherDiscountAmount,
      discountAmount: collaboratorDiscountAmount + voucherDiscountAmount,
      totalAmount: voucherBaseAmount - voucherDiscountAmount
    };
  });
}

function discountedCryptoAmount(collaboratorAmount: number, quote: VoucherQuote) {
  const percentageDiscount = (collaboratorAmount * quote.discountPercent) / 100;
  const discount = quote.maxDiscountUsdt === null ? percentageDiscount : Math.min(percentageDiscount, quote.maxDiscountUsdt);
  return roundUsdt(Math.max(0.00000001, collaboratorAmount - discount));
}

function priceOrderLine<T extends { webPrice: number; botPrice: number; price: number; collaboratorDiscountPercent: number }>(
  product: T,
  quantity: number,
  channel: SalesChannel,
  role: CustomerRole
) {
  const unitPrice = channelPrice(product, channel);
  const subtotalAmount = unitPrice * quantity;
  const collaboratorDiscountPercent = role === CustomerRole.COLLABORATOR ? product.collaboratorDiscountPercent : 0;
  const collaboratorDiscountAmount = Math.floor((subtotalAmount * collaboratorDiscountPercent) / 100);
  return {
    product,
    quantity,
    unitPrice,
    subtotalAmount,
    collaboratorDiscountPercent,
    collaboratorDiscountAmount,
    collaboratorSubtotal: subtotalAmount - collaboratorDiscountAmount
  };
}

function summarizePricing(lines: Array<{ subtotalAmount: number; collaboratorDiscountAmount: number }>): PricingSummary {
  const subtotalAmount = lines.reduce((sum, line) => sum + line.subtotalAmount, 0);
  const collaboratorDiscountAmount = lines.reduce((sum, line) => sum + line.collaboratorDiscountAmount, 0);
  return {
    subtotalAmount,
    collaboratorDiscountAmount,
    collaboratorSubtotal: subtotalAmount - collaboratorDiscountAmount
  };
}

function formatCartDelivery(orders: Array<{ product: { name: string }; deliveryText?: string | null }>) {
  if (orders.length === 1) return orders[0].deliveryText ?? "";
  return orders.map((order) => `${order.product.name}\n${order.deliveryText ?? ""}`.trim()).join("\n\n");
}

function assertNonNegativeStock(value?: number) {
  if (value === undefined) return;
  if (!Number.isInteger(value) || value < 0) {
    throw new BadRequestException("So luong phai la so nguyen khong am.");
  }
}

function assertCollaboratorDiscount(value?: number) {
  if (value === undefined) return;
  if (!Number.isInteger(value) || value < 0 || value > 90) {
    throw new BadRequestException("Mức giảm cho cộng tác viên phải từ 0 đến 90%.");
  }
}

function assertActiveUser(user: { isBlocked?: boolean }) {
  if (user.isBlocked) throw new BadRequestException("Tài khoản đã bị khóa.");
}

function normalizeProductPrices(input: Partial<ProductInput>, required: boolean) {
  const basePrice = input.price ?? input.webPrice ?? input.botPrice;
  if (required && basePrice === undefined) {
    throw new BadRequestException("Can nhap gia bot va gia web.");
  }

  const botPrice = input.botPrice ?? input.price;
  const webPrice = input.webPrice ?? input.price;
  const data: { price?: number; botPrice?: number; webPrice?: number; usdtPrice?: Prisma.Decimal | null } = {};

  if (botPrice !== undefined) {
    assertPositiveVnd(botPrice);
    data.botPrice = botPrice;
  }
  if (webPrice !== undefined) {
    assertPositiveVnd(webPrice);
    data.webPrice = webPrice;
    data.price = webPrice;
  } else if (input.price !== undefined) {
    assertPositiveVnd(input.price);
    data.price = input.price;
  }

  if (required) {
    const finalBotPrice = data.botPrice ?? basePrice!;
    const finalWebPrice = data.webPrice ?? basePrice!;
    assertPositiveVnd(finalBotPrice);
    assertPositiveVnd(finalWebPrice);
    data.botPrice = finalBotPrice;
    data.webPrice = finalWebPrice;
    data.price = finalWebPrice;
  }

  if (input.usdtPrice !== undefined) {
    data.usdtPrice = normalizeUsdtPrice(input.usdtPrice);
  }

  return data;
}

function normalizeUsdtPrice(value: number | string | null) {
  if (value === null || value === "") return null;
  const amount = typeof value === "number" ? value : Number(String(value).trim());
  if (!Number.isFinite(amount) || amount < 0) {
    throw new BadRequestException("Gia USDT khong hop le.");
  }
  return new Prisma.Decimal(roundUsdt(amount));
}

function decimalNumber(value: unknown) {
  if (value === null || value === undefined) return null;
  const parsed = Number(String(value));
  return Number.isFinite(parsed) ? parsed : null;
}

function roundUsdt(value: number) {
  return value.toFixed(8).replace(/0+$/, "").replace(/\.$/, "");
}

function cryptomusSign(bodyText: string, paymentApiKey: string) {
  return crypto.createHash("md5").update(Buffer.from(bodyText).toString("base64") + paymentApiKey).digest("hex");
}

function buildQrCodeUrl(content: string) {
  const baseUrl = process.env.QR_IMAGE_BASE_URL ?? "https://api.qrserver.com/v1/create-qr-code/";
  const params = new URLSearchParams({
    size: "420x420",
    margin: "16",
    data: content
  });
  return `${baseUrl.replace(/\?$/, "")}?${params.toString()}`;
}

function productVisibilityWhere(channel: SalesChannel): Prisma.ProductWhereInput {
  return {
    status: ProductStatus.ACTIVE,
    ...(channel === "bot" ? { showInBot: true } : { showInWeb: true })
  };
}

function isVisibleForChannel(
  product: { status: ProductStatus; showInBot?: boolean | null; showInWeb?: boolean | null },
  channel: SalesChannel
) {
  if (product.status !== ProductStatus.ACTIVE) return false;
  return channel === "bot" ? product.showInBot !== false : product.showInWeb !== false;
}

function channelPrice(product: { price: number; botPrice?: number | null; webPrice?: number | null }, channel: SalesChannel) {
  const price = channel === "bot" ? product.botPrice : product.webPrice;
  return price && price > 0 ? price : product.price;
}

function applyChannelPrice<
  T extends {
    price: number;
    botPrice?: number | null;
    webPrice?: number | null;
    usdtPrice?: Prisma.Decimal | number | string | null;
    collaboratorDiscountPercent?: number | null;
  }
>(product: T, channel: SalesChannel, customerRole: CustomerRole = CustomerRole.CUSTOMER) {
  const regularPrice = channelPrice(product, channel);
  const collaboratorDiscountPercent =
    customerRole === CustomerRole.COLLABORATOR ? Number(product.collaboratorDiscountPercent ?? 0) : 0;
  const collaboratorPrice = regularPrice - Math.floor((regularPrice * collaboratorDiscountPercent) / 100);
  const regularUsdtPrice = decimalNumber(product.usdtPrice);
  const collaboratorUsdtPrice =
    regularUsdtPrice === null ? null : roundUsdt(regularUsdtPrice * (1 - collaboratorDiscountPercent / 100));
  return {
    ...product,
    price: collaboratorPrice,
    regularPrice,
    collaboratorPrice,
    collaboratorDiscountPercent,
    usdtPrice: collaboratorUsdtPrice,
    regularUsdtPrice,
    collaboratorUsdtPrice
  };
}

export function slugify(input: string) {
  return input
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)+/g, "");
}

function defaultManualInstructions() {
  const username = process.env.ADMIN_TELEGRAM_USERNAME ?? "vanhdao99";
  return `Vui lòng ib admin @${username} để nhận hàng.`;
}

const defaultProductIcon = "🛍️";
const brandIconRules = [
  { icon: "🤖", keywords: ["chatgpt", "openai", "gpt"] },
  { icon: "🟫", keywords: ["claude", "anthropic"] },
  { icon: "✦", keywords: ["gemini"] },
  { icon: "🅰️", keywords: ["adobe", "photoshop", "premiere", "after effect", "illustrator"] },
  { icon: "🎬", keywords: ["capcut"] },
  { icon: "▶️", keywords: ["youtube", "yt"] },
  { icon: "🟣", keywords: ["canva"] },
  { icon: "𝕏", keywords: ["grok", "twitter", "x premium"] },
  { icon: "🌐", keywords: ["google", "drive", "gmail"] },
  { icon: "🪟", keywords: ["microsoft", "office", "copilot", "onedrive"] },
  { icon: "⌘", keywords: ["cursor"] },
  { icon: "🎨", keywords: ["midjourney", "mj"] },
  { icon: "▣", keywords: ["notion"] },
  { icon: "🎧", keywords: ["spotify"] },
  { icon: "🎞️", keywords: ["netflix"] },
  { icon: "🧠", keywords: ["ai"] },
  { icon: "🔗", keywords: ["api"] }
];

function normalizeProductIcon(input?: string | null, productName?: string) {
  const icon = input?.trim();
  if (icon && icon !== defaultProductIcon) return icon;
  const inferred = inferBrandIcon(productName);
  return inferred ?? icon ?? defaultProductIcon;
}

function inferBrandIcon(productName?: string) {
  const normalizedName = productName?.toLocaleLowerCase("vi-VN") ?? "";
  return brandIconRules.find((rule) => rule.keywords.some((keyword) => normalizedName.includes(keyword)))?.icon;
}

function buildNewStockBroadcastMessage(
  product: {
    name: string;
    description?: string | null;
    price: number;
    botPrice?: number | null;
    webPrice?: number | null;
    deliveryType: ProductDeliveryType;
  },
  addedCount: number | null,
  stock: number | null
) {
  const productName = escapeHtml(product.name);
  const addedLine =
    addedCount === null ? `Shop đã lên sản phẩm mới: ${productName}!` : `Shop đã lên thêm ${addedCount} con ${productName}!`;
  const stockText = stock === null ? "Không giới hạn" : String(stock);
  const note = product.description?.trim() ? product.description.trim() : `${product.name} đã có thêm slot mới!`;

  return [
    "🚀 THÔNG BÁO HÀNG MỚI 🚀",
    "✨ ──────────────────────── ✨",
    addedLine,
    `💰 Giá: ${formatVnd(channelPrice(product, "bot"))}`,
    `💾 Kho: ${escapeHtml(stockText)}`,
    `✨ Ghi chú: ${escapeHtml(note)}`,
    "✨ ──────────────────────── ✨",
    "👉 Nhấn /shop để mua hàng ngay!"
  ].join("\n");
}

function escapeHtml(input: string) {
  return input.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

type RevenuePayment = {
  amount: number;
  createdAt: Date;
};

function buildDailyRevenueSeries(days: number, payments: RevenuePayment[]) {
  const map = new Map<string, { key: string; label: string; revenue: number; orders: number }>();
  for (let index = days - 1; index >= 0; index -= 1) {
    const date = new Date(Date.now() - index * 24 * 60 * 60 * 1000);
    const key = dayKey(date);
    map.set(key, { key, label: dayLabel(date), revenue: 0, orders: 0 });
  }
  for (const payment of payments) {
    const key = dayKey(payment.createdAt);
    const current = map.get(key);
    if (!current) continue;
    current.revenue += payment.amount;
    current.orders += 1;
  }
  return Array.from(map.values());
}

function buildMonthlyRevenueSeries(months: number, payments: RevenuePayment[]) {
  const nowParts = dateParts(new Date());
  const map = new Map<string, { key: string; label: string; revenue: number; orders: number }>();
  for (let index = months - 1; index >= 0; index -= 1) {
    const monthIndex = nowParts.month - 1 - index;
    const year = nowParts.year + Math.floor(monthIndex / 12);
    const month = ((monthIndex % 12) + 12) % 12 + 1;
    const key = `${year}-${String(month).padStart(2, "0")}`;
    map.set(key, { key, label: `${String(month).padStart(2, "0")}/${year}`, revenue: 0, orders: 0 });
  }
  for (const payment of payments) {
    const key = monthKey(payment.createdAt);
    const current = map.get(key);
    if (!current) continue;
    current.revenue += payment.amount;
    current.orders += 1;
  }
  return Array.from(map.values());
}

function dayKey(date: Date) {
  const parts = dateParts(date);
  return `${parts.year}-${String(parts.month).padStart(2, "0")}-${String(parts.day).padStart(2, "0")}`;
}

function monthKey(date: Date) {
  const parts = dateParts(date);
  return `${parts.year}-${String(parts.month).padStart(2, "0")}`;
}

function dayLabel(date: Date) {
  const parts = dateParts(date);
  return `${String(parts.day).padStart(2, "0")}/${String(parts.month).padStart(2, "0")}`;
}

function dateParts(date: Date) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Ho_Chi_Minh",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(date);

  return {
    year: Number(parts.find((part) => part.type === "year")?.value),
    month: Number(parts.find((part) => part.type === "month")?.value),
    day: Number(parts.find((part) => part.type === "day")?.value)
  };
}

/**
 * Detect brand from product name and return the corresponding product-art URL.
 * Same logic as the frontend `brandTone` function to keep images consistent.
 */
function detectBrandImageUrl(name: string): string {
  const lower = name.toLowerCase();
  let brand = "default";
  if (lower.includes("chatgpt") || lower.includes("openai")) brand = "openai";
  else if (lower.includes("claude")) brand = "claude";
  else if (lower.includes("gemini") || lower.includes("gemeni")) brand = "gemini";
  else if (lower.includes("canva")) brand = "canva";
  else if (lower.includes("youtube")) brand = "youtube";
  else if (lower.includes("adobe")) brand = "adobe";
  else if (lower.includes("capcut")) brand = "capcut";
  else if (lower.includes("grok")) brand = "grok";
  else if (lower.includes("cursor")) brand = "cursor";
  return `/product-art/${brand}.svg`;
}
