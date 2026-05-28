import { BadRequestException, Injectable, UnauthorizedException } from "@nestjs/common";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { randomUUID } from "node:crypto";
import { PrismaService } from "../prisma.service";
import { ShopService } from "../domain/shop.service";

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

  product(productId: string) {
    return this.shop.getProduct(productId, "web");
  }

  async wallet(customerId: string) {
    return { balance: await this.shop.getWalletBalance(customerId) };
  }

  history(telegramId: string) {
    return this.shop.getHistory(telegramId);
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

    return {
      code: payment.code,
      kind: payment.kind,
      status: payment.status,
      amount: payment.amount,
      expiresAt: payment.expiresAt,
      balance: await this.shop.getWalletBalance(customerId),
      order: payment.order
        ? {
            code: payment.order.code,
            status: payment.order.status,
            quantity: payment.order.quantity,
            totalAmount: payment.order.totalAmount,
            deliveryText: payment.order.deliveryText,
            product: payment.order.product
          }
        : null
    };
  }

  createTopup(telegramId: string, amount: number) {
    return this.shop.createTopup(telegramId, amount);
  }

  purchaseWithWallet(telegramId: string, productId: string, quantity: number) {
    return this.shop.purchaseWithWallet(telegramId, productId, quantity, "web");
  }

  createBankOrder(telegramId: string, productId: string, quantity: number) {
    return this.shop.createBankOrder(telegramId, productId, quantity, "web");
  }

  private session(customer: { id: string; email: string | null; displayName: string | null; telegramId: string }) {
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

  private publicCustomer(customer: { id: string; email: string | null; displayName: string | null }) {
    return {
      id: customer.id,
      email: customer.email,
      displayName: customer.displayName
    };
  }
}

function normalizeEmail(email: string) {
  return email.toLowerCase().trim();
}
