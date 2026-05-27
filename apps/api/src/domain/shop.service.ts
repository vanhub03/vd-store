import { BadRequestException, Injectable, Logger, NotFoundException } from "@nestjs/common";
import {
  InventoryStatus,
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
  slug?: string;
  description?: string | null;
  imageUrl?: string | null;
  price: number;
  status?: ProductStatus;
  deliveryType: ProductDeliveryType;
  sharedContent?: string | null;
  sharedFilePath?: string | null;
  manualInstructions?: string | null;
  manualStock?: number;
};

@Injectable()
export class ShopService {
  private readonly logger = new Logger(ShopService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly broadcasts: BroadcastService
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

  async getCatalog() {
    const categories = await this.prisma.category.findMany({
      where: { active: true },
      orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
      include: {
        products: {
          where: { status: ProductStatus.ACTIVE },
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
      where: { categoryId: null, status: ProductStatus.ACTIVE },
      orderBy: { createdAt: "desc" },
      include: {
        _count: {
          select: {
            inventoryItems: { where: { status: InventoryStatus.AVAILABLE } }
          }
        }
      }
    });

    return { categories, uncategorized };
  }

  async getProduct(productId: string) {
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
    if (!product || product.status !== ProductStatus.ACTIVE) {
      throw new NotFoundException("Không tìm thấy sản phẩm.");
    }
    return product;
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

  async createBankOrder(telegramId: string, productId: string, quantity = 1) {
    if (!Number.isInteger(quantity) || quantity <= 0) {
      throw new BadRequestException("Số lượng không hợp lệ.");
    }

    const user = await this.requireTelegramUser(telegramId);
    const product = await this.getActiveProduct(productId);
    await this.ensurePurchasable(product, quantity);

    const code = await this.createUniqueCode(DIRECT_ORDER_PREFIX);
    const totalAmount = product.price * quantity;
    const expiresAt = minutesFromNow(10);
    const qrImageUrl = this.buildVietQrImageUrl(totalAmount, code);

    const order = await this.prisma.order.create({
      data: {
        code,
        userId: user.id,
        productId: product.id,
        quantity,
        unitPrice: product.price,
        totalAmount,
        status: OrderStatus.PENDING_PAYMENT,
        paymentMethod: PaymentMethod.BANK_TRANSFER,
        expiresAt,
        payments: {
          create: {
            code,
            kind: PaymentKind.DIRECT_ORDER,
            status: PaymentStatus.PENDING,
            amount: totalAmount,
            expectedAmount: totalAmount,
            userId: user.id,
            expiresAt,
            qrImageUrl,
            qrPayload: code
          }
        }
      },
      include: { payments: true, product: true }
    });

    return { order, payment: order.payments[0], code, amount: totalAmount, expiresAt, qrImageUrl };
  }

  async purchaseWithWallet(telegramId: string, productId: string, quantity = 1) {
    if (!Number.isInteger(quantity) || quantity <= 0) {
      throw new BadRequestException("Số lượng không hợp lệ.");
    }

    return this.prisma.$transaction(
      async (tx) => {
        const user = await tx.telegramUser.findUnique({ where: { telegramId: String(telegramId) } });
        if (!user) throw new NotFoundException("User chưa đăng ký bot.");

        const product = await tx.product.findUnique({ where: { id: productId } });
        if (!product || product.status !== ProductStatus.ACTIVE) {
          throw new NotFoundException("Không tìm thấy sản phẩm.");
        }
        await this.ensurePurchasable(product, quantity, tx);

        const totalAmount = product.price * quantity;
        const balance = await this.getWalletBalance(user.id, tx);
        if (balance < totalAmount) {
          throw new BadRequestException("Số dư không đủ.");
        }

        const code = await this.createUniqueCode("VI", tx);
        const order = await tx.order.create({
          data: {
            code,
            userId: user.id,
            productId: product.id,
            quantity,
            unitPrice: product.price,
            totalAmount,
            status: OrderStatus.PAID,
            paymentMethod: PaymentMethod.WALLET
          }
        });

        const payment = await tx.payment.create({
          data: {
            code,
            kind: PaymentKind.WALLET_PURCHASE,
            status: PaymentStatus.SUCCEEDED,
            amount: totalAmount,
            expectedAmount: totalAmount,
            userId: user.id,
            orderId: order.id
          }
        });

        await tx.walletLedgerEntry.create({
          data: {
            userId: user.id,
            amount: -totalAmount,
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

        return { order: fulfilledOrder, payment, deliveryText, balanceAfter: balance - totalAmount };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }
    );
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
          await tx.order.update({
            where: { id: payment.order.id },
            data: { status: OrderStatus.CREDITED_TO_WALLET }
          });
          return { outcome: "credited_late_payment" as const, payment: updatedPayment, user: payment.order.user };
        }

        try {
          await this.ensurePurchasable(payment.order.product, payment.order.quantity, tx);
          const deliveryText = await this.fulfillOrderItems(tx, payment.order.id, payment.order.product, payment.order.quantity);
          const updatedPayment = await tx.payment.update({
            where: { id: payment.id },
            data: { status: PaymentStatus.SUCCEEDED }
          });
          const order = await tx.order.update({
            where: { id: payment.order.id },
            data: {
              status: OrderStatus.FULFILLED,
              deliveryText,
              fulfilledAt: new Date()
            }
          });
          return { outcome: "fulfilled" as const, payment: updatedPayment, order, deliveryText, user: payment.order.user };
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
          await tx.order.update({
            where: { id: payment.order.id },
            data: { status: OrderStatus.CREDITED_TO_WALLET }
          });
          return { outcome: "credited_out_of_stock" as const, payment: updatedPayment, user: payment.order.user, error };
        }
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }
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
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }
    );
  }

  async markPaymentManualReview(paymentId: string, reason: string) {
    const payment = await this.prisma.payment.update({
      where: { id: paymentId },
      data: { status: PaymentStatus.MANUAL_REVIEW }
    });
    if (payment.orderId) {
      await this.prisma.order.update({
        where: { id: payment.orderId },
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
    return this.prisma.payment.update({
      where: { id: paymentId },
      data: { telegramChatId: String(telegramChatId), telegramMessageId }
    });
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

  async listAdminUsers() {
    const users = await this.prisma.telegramUser.findMany({
      orderBy: { createdAt: "desc" },
      take: 200
    });
    const balances = await Promise.all(users.map((user) => this.getWalletBalance(user.id)));
    return users.map((user, index) => ({ ...user, balance: balances[index] }));
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
    });
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
    assertPositiveVnd(input.price);
    assertNonNegativeStock(input.manualStock);
    const product = await this.prisma.product.create({
      data: {
        ...input,
        slug: input.slug ? slugify(input.slug) : slugify(input.name),
        manualInstructions: input.manualInstructions?.trim() || defaultManualInstructions()
      }
    });
    await this.audit(adminId, "PRODUCT_CREATE", "Product", product.id, { name: product.name });
    await this.announceNewProductIfReady(product, adminId);
    return product;
  }

  async updateProduct(productId: string, input: Partial<ProductInput>, adminId: string) {
    if (input.price !== undefined) assertPositiveVnd(input.price);
    assertNonNegativeStock(input.manualStock);
    const previous = await this.prisma.product.findUnique({ where: { id: productId } });
    if (!previous) throw new NotFoundException("Không tìm thấy sản phẩm.");

    const product = await this.prisma.product.update({
      where: { id: productId },
      data: {
        ...input,
        slug: input.slug ? slugify(input.slug) : undefined,
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

  async listOrders() {
    return this.prisma.order.findMany({
      orderBy: { createdAt: "desc" },
      take: 200,
      include: { user: true, product: true, payments: true }
    });
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

    const [stats, dailyPayments, monthlyPayments, walletTotal, walletCredits, walletDebits, topWalletGroups, recentWalletEntries] =
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
      await this.prisma.payment.update({
        where: { id: payment.id },
        data: { status: PaymentStatus.EXPIRED }
      });
      if (payment.order?.status === OrderStatus.PENDING_PAYMENT) {
        await this.prisma.order.update({
          where: { id: payment.order.id },
          data: { status: OrderStatus.EXPIRED }
        });
      }
    }
    return pending;
  }

  private async requireTelegramUser(telegramId: string) {
    const user = await this.prisma.telegramUser.findUnique({ where: { telegramId: String(telegramId) } });
    if (!user) throw new NotFoundException("User chưa đăng ký bot.");
    return user;
  }

  private async getActiveProduct(productId: string) {
    const product = await this.prisma.product.findUnique({ where: { id: productId } });
    if (!product || product.status !== ProductStatus.ACTIVE) {
      throw new NotFoundException("Không tìm thấy sản phẩm.");
    }
    return product;
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
    status: ProductStatus;
    deliveryType: ProductDeliveryType;
    manualStock?: number | null;
  }, adminId: string) {
    if (product.status !== ProductStatus.ACTIVE) return;
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
      status: ProductStatus;
      deliveryType: ProductDeliveryType;
      manualStock?: number | null;
    },
    adminId: string
  ) {
    if (product.status !== ProductStatus.ACTIVE || product.deliveryType !== ProductDeliveryType.MANUAL) return;
    const previousStock = previous.deliveryType === ProductDeliveryType.MANUAL && previous.status === ProductStatus.ACTIVE ? previous.manualStock ?? 0 : 0;
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
      status: ProductStatus;
      deliveryType: ProductDeliveryType;
    },
    addedCount: number,
    adminId: string
  ) {
    if (product.status !== ProductStatus.ACTIVE || product.deliveryType !== ProductDeliveryType.STOCK_ITEM || addedCount <= 0) return;
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

function assertNonNegativeStock(value?: number) {
  if (value === undefined) return;
  if (!Number.isInteger(value) || value < 0) {
    throw new BadRequestException("So luong phai la so nguyen khong am.");
  }
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

function buildNewStockBroadcastMessage(
  product: {
    name: string;
    description?: string | null;
    price: number;
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
    `💰 Giá: ${formatVnd(product.price)}`,
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
