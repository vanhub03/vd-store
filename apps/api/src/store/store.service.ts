import { BadRequestException, Injectable, UnauthorizedException } from "@nestjs/common";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { randomUUID } from "node:crypto";
import { CustomerRole, OrderStatus, PaymentStatus, ProductStatus } from "@prisma/client";
import { PrismaService } from "../prisma.service";
import { CartOrderItemInput, ShopService, VoucherClaim } from "../domain/shop.service";

@Injectable()
export class StoreService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly shop: ShopService
  ) {}

  async register(email: string, password: string, name?: string) {
    const normalizedEmail = normalizeEmail(email);
    const existing = await this.prisma.telegramUser.findUnique({ where: { email: normalizedEmail } });
    if (existing) throw new BadRequestException("Email đã được đăng ký.");

    const passwordHash = await bcrypt.hash(password, 10);
    const customer = await this.prisma.telegramUser.create({
      data: {
        telegramId: `web:${randomUUID()}`,
        email: normalizedEmail,
        passwordHash,
        displayName: name?.trim() || normalizedEmail.split("@")[0],
        username: normalizedEmail
      }
    });

    return this.session(customer);
  }

  async login(email: string, password: string) {
    const normalizedEmail = normalizeEmail(email);
    const customer = await this.prisma.telegramUser.findUnique({ where: { email: normalizedEmail } });
    if (!customer?.passwordHash) throw new UnauthorizedException("Email hoặc mật khẩu không đúng.");

    if (customer.isBlocked) throw new UnauthorizedException("Tài khoản đã bị khóa.");
    const ok = await bcrypt.compare(password, customer.passwordHash);
    if (!ok) throw new UnauthorizedException("Email hoặc mật khẩu không đúng.");
    return this.session(customer);
  }

  async profile(customerId: string) {
    const customer = await this.prisma.telegramUser.findUnique({ where: { id: customerId } });
    if (!customer?.email) throw new UnauthorizedException("Customer no longer exists.");
    const balance = await this.shop.getWalletBalance(customer.id);
    return {
      customer: this.publicCustomer(customer),
      wallet: { balance }
    };
  }

  catalog() {
    return this.shop.getCatalog("web");
  }

  async memberCatalog(customerId: string) {
    const customer = await this.requireActiveCustomer(customerId);
    return this.shop.getCatalog("web", customer.role);
  }

  product(productId: string) {
    return this.shop.getProduct(productId, "web");
  }

  async memberProduct(customerId: string, productId: string) {
    const customer = await this.requireActiveCustomer(customerId);
    return this.shop.getProduct(productId, "web", customer.role);
  }

  async reviews() {
    const reviews = await this.prisma.withConnectionRetry(
      () =>
        this.prisma.productReview.findMany({
          where: {
            product: {
              status: ProductStatus.ACTIVE,
              showInWeb: true
            }
          },
          orderBy: { createdAt: "desc" },
          take: 18,
          include: {
            user: {
              select: {
                displayName: true,
                email: true,
                username: true
              }
            },
            product: {
              select: {
                id: true,
                name: true,
                nameEn: true,
                imageUrl: true,
                buttonIcon: true
              }
            }
          }
        }),
      "store reviews"
    );
    return { reviews: reviews.map(publicReview) };
  }

  async createReview(customerId: string, input: { productId: string; rating: number; title?: string; content: string }) {
    const product = await this.prisma.product.findFirst({
      where: {
        id: input.productId,
        status: ProductStatus.ACTIVE,
        showInWeb: true
      },
      select: { id: true }
    });
    if (!product) throw new BadRequestException("Sản phẩm không hợp lệ.");

    const content = input.content.trim().replace(/\s+/g, " ");
    const title = input.title?.trim().replace(/\s+/g, " ") || null;
    if (content.length < 8) throw new BadRequestException("Nội dung review quá ngắn.");
    if (content.length > 800) throw new BadRequestException("Nội dung review tối đa 800 ký tự.");
    if (title && title.length > 90) throw new BadRequestException("Tiêu đề review tối đa 90 ký tự.");

    const review = await this.prisma.productReview.create({
      data: {
        userId: customerId,
        productId: product.id,
        rating: Math.max(1, Math.min(5, Math.round(input.rating))),
        title,
        content
      },
      include: {
        user: {
          select: {
            displayName: true,
            email: true,
            username: true
          }
        },
        product: {
          select: {
            id: true,
            name: true,
            nameEn: true,
            imageUrl: true,
            buttonIcon: true
          }
        }
      }
    });

    return { review: publicReview(review) };
  }

  async wallet(customerId: string) {
    return { balance: await this.shop.getWalletBalance(customerId) };
  }

  history(telegramId: string) {
    return this.shop.getHistory(telegramId);
  }

  myVouchers(customerId: string) {
    return this.shop.listCustomerVouchers(customerId);
  }

  async paymentStatus(customerId: string, code: string) {
    const payment = await this.prisma.payment.findFirst({
      where: {
        code: code.trim().toUpperCase(),
        userId: customerId
      },
      include: {
        order: {
          include: {
            product: {
              select: {
                id: true,
                name: true,
                deliveryType: true
              }
            }
          }
        }
      }
    });
    if (!payment) throw new BadRequestException("Khong tim thay giao dich.");

    const effectiveStatus = await this.resolvePaymentStatus(payment);
    const effectiveOrderStatus =
      effectiveStatus === PaymentStatus.EXPIRED && payment.order?.status === OrderStatus.PENDING_PAYMENT ? OrderStatus.EXPIRED : payment.order?.status;
    const groupOrders = payment.order?.checkoutGroupId
      ? await this.prisma.order.findMany({
          where: { checkoutGroupId: payment.order.checkoutGroupId },
          orderBy: { createdAt: "asc" },
          include: { product: { select: { id: true, name: true, deliveryType: true } } }
        })
      : payment.order
        ? [payment.order]
        : [];
    const deliveryText = groupOrders.length > 1 ? groupOrders.map((order) => `${order.product.name}\n${order.deliveryText ?? ""}`.trim()).join("\n\n") : payment.order?.deliveryText;

    return {
      code: payment.code,
      kind: payment.kind,
      status: effectiveStatus,
      amount: payment.amount,
      cryptoCurrency: payment.cryptoCurrency,
      cryptoAmount: payment.cryptoAmount,
      checkoutUrl: payment.checkoutUrl,
      deeplink: payment.deeplink,
      qrImageUrl: payment.qrImageUrl,
      qrPayload: payment.qrPayload,
      address: cryptoAddress(payment.providerPayload) ?? payment.qrPayload,
      network: cryptoNetwork(payment.providerPayload),
      expiresAt: payment.expiresAt,
      balance: await this.shop.getWalletBalance(customerId),
      order: payment.order
        ? {
            code: payment.order.code,
            status: effectiveOrderStatus,
            quantity: groupOrders.reduce((sum, order) => sum + order.quantity, 0),
            totalAmount: payment.amount,
            deliveryText,
            product: groupOrders.length > 1 ? { id: payment.order.id, name: `${groupOrders.length} sản phẩm`, deliveryType: "MANUAL" as const } : payment.order.product
          }
        : null,
      orders: groupOrders
    };
  }

  private async resolvePaymentStatus(payment: {
    id: string;
    status: PaymentStatus;
    expiresAt: Date | null;
    order: { id: string; status: OrderStatus; expiresAt: Date | null; checkoutGroupId: string | null } | null;
  }) {
    if (payment.status !== PaymentStatus.PENDING) return payment.status;

    const expiresAt = payment.expiresAt ?? payment.order?.expiresAt;
    if (!expiresAt || expiresAt >= new Date()) return payment.status;

    await this.prisma.payment.update({
      where: { id: payment.id },
      data: { status: PaymentStatus.EXPIRED }
    });
    if (payment.order?.status === OrderStatus.PENDING_PAYMENT) {
      if (typeof this.shop.releaseVoucherReservation === "function") {
        await this.shop.releaseVoucherReservation(payment.order.id);
      }
      if (payment.order.checkoutGroupId) {
        await this.prisma.order.updateMany({
          where: { checkoutGroupId: payment.order.checkoutGroupId },
          data: { status: OrderStatus.EXPIRED }
        });
      } else {
        await this.prisma.order.update({
          where: { id: payment.order.id },
          data: { status: OrderStatus.EXPIRED }
        });
      }
    }
    return PaymentStatus.EXPIRED;
  }

  createTopup(telegramId: string, amount: number) {
    return this.shop.createTopup(telegramId, amount);
  }

  purchaseWithWallet(telegramId: string, productId: string, quantity: number, voucherCode?: string | null, voucherClaim?: VoucherClaim | null) {
    return this.shop.purchaseWithWallet(telegramId, productId, quantity, "web", voucherCode, voucherClaim);
  }

  createBankOrder(telegramId: string, productId: string, quantity: number, voucherCode?: string | null, voucherClaim?: VoucherClaim | null) {
    return this.shop.createBankOrder(telegramId, productId, quantity, "web", voucherCode, voucherClaim);
  }

  createUsdtOrder(telegramId: string, productId: string, quantity: number, voucherCode?: string | null, voucherClaim?: VoucherClaim | null) {
    return this.shop.createCryptomusOrder(telegramId, productId, quantity, "web", voucherCode, voucherClaim);
  }

  previewVoucher(telegramId: string, productId: string, quantity: number, voucherCode: string, voucherClaim?: VoucherClaim | null) {
    return this.shop.previewVoucher(telegramId, productId, quantity, voucherCode, "web", voucherClaim);
  }

  previewCartVoucher(telegramId: string, items: CartOrderItemInput[], voucherCode: string, voucherClaim?: VoucherClaim | null) {
    return this.shop.previewCartVoucher(telegramId, items, voucherCode, "web", voucherClaim);
  }

  purchaseCartWithWallet(telegramId: string, items: CartOrderItemInput[], voucherCode?: string | null, voucherClaim?: VoucherClaim | null) {
    return this.shop.purchaseCartWithWallet(telegramId, items, "web", voucherCode, voucherClaim);
  }

  createCartBankOrder(telegramId: string, items: CartOrderItemInput[], voucherCode?: string | null, voucherClaim?: VoucherClaim | null) {
    return this.shop.createCartBankOrder(telegramId, items, "web", voucherCode, voucherClaim);
  }

  createCartUsdtOrder(telegramId: string, items: CartOrderItemInput[], voucherCode?: string | null, voucherClaim?: VoucherClaim | null) {
    return this.shop.createCartCryptomusOrder(telegramId, items, "web", voucherCode, voucherClaim);
  }

  private async requireActiveCustomer(customerId: string) {
    const customer = await this.prisma.telegramUser.findUnique({ where: { id: customerId } });
    if (!customer?.email || !customer.passwordHash) throw new UnauthorizedException("Customer no longer exists.");
    if (customer.isBlocked) throw new UnauthorizedException("Tài khoản đã bị khóa.");
    return customer;
  }

  private session(customer: {
    id: string;
    email: string | null;
    displayName: string | null;
    telegramId: string;
    role: CustomerRole;
    isBlocked: boolean;
  }) {
    if (!customer.email) throw new UnauthorizedException("Customer email missing.");
    const token = jwt.sign(
      {
        sub: customer.id,
        email: customer.email,
        kind: "customer"
      },
      process.env.JWT_SECRET ?? "dev-secret",
      { expiresIn: "14d" }
    );

    return {
      token,
      customer: this.publicCustomer(customer)
    };
  }

  private publicCustomer(customer: {
    id: string;
    email: string | null;
    displayName: string | null;
    role: CustomerRole;
    isBlocked: boolean;
  }) {
    return {
      id: customer.id,
      email: customer.email,
      displayName: customer.displayName,
      role: customer.role,
      isBlocked: customer.isBlocked
    };
  }
}

function normalizeEmail(email: string) {
  return email.toLowerCase().trim();
}

function publicReview(review: {
  id: string;
  rating: number;
  title: string | null;
  content: string;
  createdAt: Date;
  user: { displayName: string | null; email: string | null; username: string | null };
  product: { id: string; name: string; nameEn: string | null; imageUrl: string | null; buttonIcon: string | null };
}) {
  return {
    id: review.id,
    rating: review.rating,
    title: review.title,
    content: review.content,
    createdAt: review.createdAt,
    author: review.user.displayName || review.user.username || maskEmail(review.user.email) || "VD customer",
    product: review.product
  };
}

function maskEmail(email: string | null) {
  if (!email) return null;
  const [name, domain] = email.split("@");
  if (!name || !domain) return email;
  return `${name.slice(0, 2)}***@${domain}`;
}

function cryptoPayload(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const payload = value as Record<string, unknown>;
  const result = payload.result;
  if (result && typeof result === "object" && !Array.isArray(result)) return result as Record<string, unknown>;
  return payload;
}

function cryptoAddress(value: unknown) {
  const payload = cryptoPayload(value);
  const address = payload?.address;
  return typeof address === "string" && address.trim() ? address.trim() : null;
}

function cryptoNetwork(value: unknown) {
  const payload = cryptoPayload(value);
  const network = payload?.network;
  return typeof network === "string" && network.trim() ? network.trim() : null;
}
