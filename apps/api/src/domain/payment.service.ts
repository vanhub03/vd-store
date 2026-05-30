import { BadRequestException, Injectable, Logger, UnauthorizedException } from "@nestjs/common";
import crypto from "node:crypto";
import { PaymentKind, PaymentStatus, Prisma } from "@prisma/client";
import { Request } from "express";
import { PrismaService } from "../prisma.service";
import { extractPaymentCode } from "./payment-codes";
import { verifyApiKeyHeader, verifySepayHmac } from "./sepay-signature";
import { ShopService } from "./shop.service";
import { TelegramNotifyService } from "./telegram-notify.service";

type RawRequest = Request & { rawBody?: Buffer };

@Injectable()
export class PaymentService {
  private readonly logger = new Logger(PaymentService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly shop: ShopService,
    private readonly telegram: TelegramNotifyService
  ) {}

  verifySepayRequest(request: RawRequest) {
    const mode = (process.env.SEPAY_AUTH_MODE ?? "hmac").toLowerCase();
    if (mode === "none") return;

    if (mode === "api-key") {
      const ok = verifyApiKeyHeader(request.headers.authorization, process.env.SEPAY_API_KEY);
      if (!ok) throw new UnauthorizedException("Invalid SePay API key.");
      return;
    }

    const ok = verifySepayHmac({
      rawBody: request.rawBody ?? Buffer.from(JSON.stringify(request.body ?? {})),
      signature: firstHeader(request.headers["x-sepay-signature"]) ?? firstHeader(request.headers["sepay-signature"]),
      timestamp: firstHeader(request.headers["x-sepay-timestamp"]) ?? firstHeader(request.headers["sepay-timestamp"]),
      secret: process.env.SEPAY_WEBHOOK_SECRET
    });
    if (!ok) throw new UnauthorizedException("Invalid SePay signature.");
  }

  verifyBinancePayRequest(request: RawRequest) {
    const mode = (process.env.BINANCE_PAY_WEBHOOK_AUTH_MODE ?? "hmac").toLowerCase();
    if (mode === "none") return;
    const secret = process.env.BINANCE_PAY_SECRET_KEY;
    const signature = firstHeader(request.headers["binancepay-signature"]) ?? firstHeader(request.headers["BinancePay-Signature" as never]);
    const timestamp = firstHeader(request.headers["binancepay-timestamp"]) ?? firstHeader(request.headers["BinancePay-Timestamp" as never]);
    const nonce = firstHeader(request.headers["binancepay-nonce"]) ?? firstHeader(request.headers["BinancePay-Nonce" as never]);
    if (!secret || !signature || !timestamp || !nonce) {
      throw new UnauthorizedException("Invalid Binance Pay signature.");
    }
    const rawBody = request.rawBody ?? Buffer.from(JSON.stringify(request.body ?? {}));
    const payload = `${timestamp}\n${nonce}\n${rawBody.toString("utf8")}\n`;
    const expected = crypto.createHmac("sha512", secret).update(payload).digest("hex").toUpperCase();
    if (!safeEqual(expected, signature.replace(/^sha512=/i, "").toUpperCase())) {
      throw new UnauthorizedException("Invalid Binance Pay signature.");
    }
  }

  async handleSepayWebhook(payload: Record<string, unknown>) {
    const normalized = normalizeSepayPayload(payload);
    if (!normalized.providerTransactionId) {
      throw new BadRequestException("Missing SePay transaction id.");
    }

    const existing = await this.prisma.bankTransaction.findUnique({
      where: { providerTransactionId: normalized.providerTransactionId }
    });
    if (existing) {
      return { ok: true, duplicate: true };
    }

    const expectedAccount = process.env.SEPAY_ACCOUNT_NUMBER;
    const accountMismatch = expectedAccount && normalized.accountNumber && expectedAccount !== normalized.accountNumber;
    const paymentCode = normalized.paymentCode ?? extractPaymentCode(normalized.content);

    const bankTransaction = await this.prisma.bankTransaction.create({
      data: {
        providerTransactionId: normalized.providerTransactionId,
        gateway: normalized.gateway,
        transactionDate: normalized.transactionDate,
        accountNumber: normalized.accountNumber,
        subAccount: normalized.subAccount,
        code: paymentCode,
        content: normalized.content,
        transferType: normalized.transferType,
        transferAmount: normalized.transferAmount,
        accumulated: normalized.accumulated,
        referenceCode: normalized.bankReferenceCode,
        rawPayload: payload as Prisma.InputJsonValue
      }
    });

    if (accountMismatch) {
      this.logger.warn(`Ignoring SePay transaction for unexpected account ${normalized.accountNumber}.`);
      return { ok: true, ignored: "account_mismatch" };
    }

    if (!normalized.isIncoming) {
      this.logger.log(`Ignoring outgoing SePay transaction ${normalized.providerTransactionId}.`);
      return { ok: true, ignored: "not_incoming" };
    }

    if (!paymentCode) {
      this.logger.warn(`Ignoring SePay transaction ${normalized.providerTransactionId}: missing payment code in content "${normalized.content ?? ""}".`);
      return { ok: true, ignored: "missing_reference_code" };
    }

    const payment = await this.prisma.payment.findUnique({
      where: { code: paymentCode },
      include: { user: true, order: true }
    });
    if (!payment) {
      this.logger.warn(`Ignoring SePay transaction ${normalized.providerTransactionId}: unknown payment code ${paymentCode}.`);
      return { ok: true, ignored: "unknown_reference_code" };
    }

    await this.prisma.bankTransaction.update({
      where: { id: bankTransaction.id },
      data: { paymentId: payment.id }
    });

    const expectedAmount = payment.expectedAmount ?? payment.amount;
    if (normalized.transferAmount !== expectedAmount) {
      await this.shop.markPaymentManualReview(payment.id, `Expected ${expectedAmount}, received ${normalized.transferAmount}`);
      await this.deletePendingPaymentMessage(payment.id, payment);
      const telegramId = payment.user?.telegramId;
      if (canNotifyTelegramUser(telegramId)) {
        await this.telegram.notifyManualReview(telegramId, payment.code);
      }
      return { ok: true, status: "manual_review" };
    }

    if (payment.kind === PaymentKind.TOPUP) {
      const result = await this.shop.creditTopup(payment.id);
      await this.deletePendingPaymentMessage(payment.id, payment);
      const telegramId = result.user?.telegramId;
      if (canNotifyTelegramUser(telegramId)) {
        await this.telegram.notifyTopup(telegramId, payment.amount, payment.code);
      }
      return { ok: true, status: result.outcome };
    }

    if (payment.kind === PaymentKind.DIRECT_ORDER) {
      const result = await this.shop.fulfillDirectOrder(payment.id);
      await this.deletePendingPaymentMessage(payment.id, payment);
      if (result.outcome === "fulfilled" && "deliveryText" in result) {
        await this.shop.notifyManualOrderIfNeeded(result.order.id);
      }
      const telegramId = result.user?.telegramId;
      if (canNotifyTelegramUser(telegramId)) {
        if (result.outcome === "fulfilled" && "deliveryText" in result) {
          await this.telegram.notifyDirectOrderFulfilled(telegramId, payment.code, result.deliveryText);
        } else if (result.outcome === "credited_late_payment") {
          await this.telegram.notifyPaymentCredited(telegramId, payment.code, payment.amount, "Đơn đã quá hạn 10 phút.");
        } else if (result.outcome === "credited_out_of_stock") {
          await this.telegram.notifyPaymentCredited(telegramId, payment.code, payment.amount, "Sản phẩm đã hết hàng.");
        }
      }
      return { ok: true, status: result.outcome };
    }

    return { ok: true, ignored: "unsupported_payment_kind" };
  }

  async handleBinancePayWebhook(payload: Record<string, unknown>) {
    const normalized = normalizeBinancePayPayload(payload);
    if (!normalized.paymentCode) throw new BadRequestException("Missing Binance Pay merchantTradeNo.");
    if (!normalized.isSuccess) return { ok: true, ignored: normalized.status ?? "not_success" };

    const payment = await this.prisma.payment.findUnique({
      where: { code: normalized.paymentCode },
      include: { user: true, order: true }
    });
    if (!payment) return { ok: true, ignored: "unknown_reference_code" };
    if (payment.providerPaymentId && normalized.providerPaymentId && payment.providerPaymentId !== normalized.providerPaymentId) {
      await this.shop.markPaymentManualReview(payment.id, "Binance Pay provider id mismatch");
      return { ok: true, status: "manual_review" };
    }
    if (normalized.providerPaymentId) {
      const duplicate = await this.prisma.payment.findFirst({
        where: { provider: "binance_pay", providerPaymentId: normalized.providerPaymentId, id: { not: payment.id }, status: { not: PaymentStatus.PENDING } }
      });
      if (duplicate) return { ok: true, duplicate: true };
    }

    const expectedCrypto = payment.cryptoAmount ? Number(String(payment.cryptoAmount)) : null;
    if (!expectedCrypto || normalized.cryptoAmount === null || Math.abs(expectedCrypto - normalized.cryptoAmount) > 0.00000001) {
      await this.shop.markPaymentManualReview(payment.id, `Expected ${expectedCrypto ?? "unknown"} USDT, received ${normalized.cryptoAmount ?? "unknown"}`);
      return { ok: true, status: "manual_review" };
    }

    if (payment.kind === PaymentKind.DIRECT_ORDER) {
      await this.prisma.payment.update({
        where: { id: payment.id },
        data: {
          providerPaymentId: normalized.providerPaymentId ?? payment.providerPaymentId,
          providerPayload: payload as Prisma.InputJsonValue
        }
      });
      const result = await this.shop.fulfillDirectOrder(payment.id);
      await this.deletePendingPaymentMessage(payment.id, payment);
      if (result.outcome === "fulfilled" && "deliveryText" in result) {
        await this.shop.notifyManualOrderIfNeeded(result.order.id);
      }
      const telegramId = result.user?.telegramId;
      if (canNotifyTelegramUser(telegramId)) {
        if (result.outcome === "fulfilled" && "deliveryText" in result) {
          await this.telegram.notifyDirectOrderFulfilled(telegramId, payment.code, result.deliveryText);
        } else if (result.outcome === "credited_late_payment") {
          await this.telegram.notifyPaymentCredited(telegramId, payment.code, payment.amount, "USDT payment arrived after expiry.");
        } else if (result.outcome === "credited_out_of_stock") {
          await this.telegram.notifyPaymentCredited(telegramId, payment.code, payment.amount, "Product is out of stock.");
        }
      }
      return { ok: true, status: result.outcome };
    }

    return { ok: true, ignored: "unsupported_payment_kind" };
  }

  private async deletePendingPaymentMessage(paymentId: string, fallback?: { telegramChatId?: string | null; telegramMessageId?: number | null }) {
    const latest = await this.prisma.payment.findUnique({
      where: { id: paymentId },
      select: { telegramChatId: true, telegramMessageId: true }
    });
    await this.telegram.deleteMessage(latest?.telegramChatId ?? fallback?.telegramChatId, latest?.telegramMessageId ?? fallback?.telegramMessageId);
  }
}

function firstHeader(value: string | string[] | undefined) {
  if (Array.isArray(value)) return value[0];
  return value;
}

function safeEqual(expected: string, actual: string) {
  const expectedBuffer = Buffer.from(expected);
  const actualBuffer = Buffer.from(actual);
  return expectedBuffer.length === actualBuffer.length && crypto.timingSafeEqual(expectedBuffer, actualBuffer);
}

function canNotifyTelegramUser(telegramId?: string | null): telegramId is string {
  return Boolean(telegramId && /^\d+$/.test(telegramId));
}

function normalizeSepayPayload(payload: Record<string, unknown>) {
  const bankReferenceCode = stringValue(payload.referenceCode) ?? stringValue(payload.reference_code);
  const id = stringValue(payload.id) ?? stringValue(payload.transactionId) ?? stringValue(payload.transaction_id) ?? bankReferenceCode;
  const content = stringValue(payload.content) ?? stringValue(payload.description) ?? stringValue(payload.transaction_content);
  const transferType = stringValue(payload.transferType) ?? stringValue(payload.transfer_type);
  const amount = numberValue(payload.transferAmount ?? payload.transfer_amount ?? payload.amount ?? payload.transaction_amount);
  const transactionDate =
    dateValue(payload.transactionDate ?? payload.transaction_date ?? payload.transactionTime ?? payload.transaction_time) ?? undefined;
  const paymentCode =
    stringValue(payload.code) ?? stringValue(payload.paymentCode) ?? stringValue(payload.payment_code) ?? stringValue(payload.va) ?? extractPaymentCode(content);
  const normalizedTransferType = transferType?.toLowerCase();

  return {
    providerTransactionId: id,
    gateway: stringValue(payload.gateway),
    transactionDate,
    accountNumber: stringValue(payload.accountNumber) ?? stringValue(payload.account_number),
    subAccount: stringValue(payload.subAccount) ?? stringValue(payload.sub_account),
    paymentCode,
    content,
    transferType,
    transferAmount: amount,
    accumulated: numberValue(payload.accumulated),
    bankReferenceCode,
    isIncoming: !normalizedTransferType || normalizedTransferType === "in" || normalizedTransferType === "credit"
  };
}

function normalizeBinancePayPayload(payload: Record<string, unknown>) {
  const data = parseJsonObject(payload.data) ?? payload;
  const status = stringValue(payload.bizStatus) ?? stringValue(data.bizStatus) ?? stringValue(data.status) ?? stringValue(data.tradeStatus);
  const paymentCode =
    stringValue(data.merchantTradeNo) ??
    stringValue(data.merchant_trade_no) ??
    stringValue(data.outTradeNo) ??
    stringValue(payload.merchantTradeNo);
  const providerPaymentId =
    stringValue(data.transactionId) ??
    stringValue(data.transaction_id) ??
    stringValue(data.prepayId) ??
    stringValue(payload.bizId) ??
    stringValue(payload.id);
  const cryptoAmount = decimalValue(data.totalFee ?? data.orderAmount ?? data.amount ?? payload.totalFee);
  return {
    paymentCode,
    providerPaymentId,
    status,
    cryptoAmount: cryptoAmount > 0 ? cryptoAmount : null,
    isSuccess: ["PAY_SUCCESS", "SUCCESS", "PAID"].includes((status ?? "").toUpperCase())
  };
}

function parseJsonObject(value: unknown) {
  if (typeof value === "object" && value !== null && !Array.isArray(value)) return value as Record<string, unknown>;
  if (typeof value !== "string") return null;
  try {
    const parsed = JSON.parse(value);
    return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

function stringValue(value: unknown) {
  if (value === null || value === undefined) return undefined;
  const result = String(value).trim();
  return result || undefined;
}

function numberValue(value: unknown) {
  if (typeof value === "number") return Math.trunc(value);
  if (typeof value === "string") {
    const parsed = Number(value.replace(/[^\d-]/g, ""));
    if (Number.isFinite(parsed)) return parsed;
  }
  return 0;
}

function decimalValue(value: unknown) {
  if (typeof value === "number") return value;
  if (typeof value === "string") {
    const parsed = Number(value.replace(/[^\d.-]/g, ""));
    if (Number.isFinite(parsed)) return parsed;
  }
  return 0;
}

function dateValue(value: unknown) {
  const raw = stringValue(value);
  if (!raw) return null;
  const date = new Date(raw);
  return Number.isNaN(date.getTime()) ? null : date;
}
