import { BadRequestException, Injectable, Logger, NotFoundException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { PrismaService } from "../prisma.service";
import { TelegramNotifyService } from "./telegram-notify.service";

export type SoldProductSubscriptionInput = {
  productId: string;
  customerName: string;
  zaloLink?: string | null;
  startDate: string;
  durationMonths: number;
  accountNote?: string | null;
};

export type UpdateSoldProductSubscriptionInput = Partial<SoldProductSubscriptionInput> & {
  active?: boolean;
};

@Injectable()
export class SoldProductSubscriptionService {
  private readonly logger = new Logger(SoldProductSubscriptionService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly telegram: TelegramNotifyService
  ) {}

  list() {
    return this.prisma.soldProductSubscription.findMany({
      orderBy: [{ active: "desc" }, { expiresAt: "asc" }, { createdAt: "desc" }]
    });
  }

  async create(adminId: string, input: SoldProductSubscriptionInput) {
    const normalized = normalizeInput(input);
    const product = await this.requireProduct(normalized.productId);
    const expiresAt = addCalendarMonths(normalized.startedAt, normalized.durationMonths);
    const subscription = await this.prisma.soldProductSubscription.create({
      data: {
        productId: product.id,
        productName: product.name,
        customerName: normalized.customerName,
        zaloLink: normalized.zaloLink,
        startedAt: normalized.startedAt,
        durationMonths: normalized.durationMonths,
        expiresAt,
        accountNote: normalized.accountNote
      }
    });
    await this.audit(adminId, "SOLD_SUBSCRIPTION_CREATE", subscription.id, {
      productId: product.id,
      customerName: subscription.customerName,
      expiresAt
    });
    return subscription;
  }

  async update(adminId: string, id: string, input: UpdateSoldProductSubscriptionInput) {
    const current = await this.prisma.soldProductSubscription.findUnique({ where: { id } });
    if (!current) throw new NotFoundException("Không tìm thấy sản phẩm đã bán.");

    const product = input.productId === undefined ? null : await this.requireProduct(input.productId);
    const startedAt = input.startDate === undefined ? current.startedAt : parseDateOnly(input.startDate, "Ngày bắt đầu");
    const durationMonths = input.durationMonths === undefined ? current.durationMonths : normalizeDuration(input.durationMonths);
    const expiresAt = addCalendarMonths(startedAt, durationMonths);
    const expirationChanged = expiresAt.getTime() !== current.expiresAt.getTime();
    const restored = input.active === true && !current.active;
    const data: Prisma.SoldProductSubscriptionUpdateInput = {
      product: product ? { connect: { id: product.id } } : undefined,
      productName: product?.name,
      customerName: input.customerName === undefined ? undefined : normalizeRequiredText(input.customerName, "Tên khách hàng"),
      zaloLink: input.zaloLink === undefined ? undefined : normalizeZaloLink(input.zaloLink),
      startedAt,
      durationMonths,
      expiresAt,
      accountNote: input.accountNote === undefined ? undefined : normalizeOptionalText(input.accountNote),
      active: input.active,
      renewalReminderFor: expirationChanged || restored ? null : undefined,
      renewalReminderClaimedAt: expirationChanged || restored ? null : undefined,
      renewalReminderSentAt: expirationChanged || restored ? null : undefined
    };
    const subscription = await this.prisma.soldProductSubscription.update({ where: { id }, data });
    await this.audit(adminId, "SOLD_SUBSCRIPTION_UPDATE", id, {
      productId: subscription.productId,
      expiresAt: subscription.expiresAt,
      active: subscription.active,
      expirationChanged
    });
    return subscription;
  }

  async renew(adminId: string, id: string, durationMonths: number) {
    const current = await this.prisma.soldProductSubscription.findUnique({ where: { id } });
    if (!current) throw new NotFoundException("Không tìm thấy sản phẩm đã bán.");
    const months = normalizeDuration(durationMonths);
    const today = vietnamCalendarDate(new Date());
    const baseDate = current.expiresAt.getTime() > today.getTime() ? current.expiresAt : today;
    const expiresAt = addCalendarMonths(baseDate, months);
    const subscription = await this.prisma.soldProductSubscription.update({
      where: { id },
      data: {
        active: true,
        durationMonths: months,
        expiresAt,
        renewalReminderFor: null,
        renewalReminderClaimedAt: null,
        renewalReminderSentAt: null
      }
    });
    await this.audit(adminId, "SOLD_SUBSCRIPTION_RENEW", id, { durationMonths: months, expiresAt });
    return subscription;
  }

  async deactivate(adminId: string, id: string) {
    const current = await this.prisma.soldProductSubscription.findUnique({ where: { id } });
    if (!current) throw new NotFoundException("Không tìm thấy sản phẩm đã bán.");
    const subscription = await this.prisma.soldProductSubscription.update({
      where: { id },
      data: { active: false }
    });
    await this.audit(adminId, "SOLD_SUBSCRIPTION_DEACTIVATE", id, { productId: current.productId });
    return subscription;
  }

  /**
   * A database claim is acquired before sending so concurrent API instances
   * cannot send the same alert twice. Failed or stale claims are retried by
   * the next hourly run.
   */
  async dispatchDueRenewalReminders() {
    const today = vietnamCalendarDate(new Date());
    const staleClaimBefore = new Date(Date.now() - 15 * 60 * 1000);
    const dueSubscriptions = await this.prisma.soldProductSubscription.findMany({
      where: {
        active: true,
        expiresAt: { lte: today },
        renewalReminderSentAt: null,
        OR: [
          { renewalReminderClaimedAt: null },
          { renewalReminderClaimedAt: { lt: staleClaimBefore } }
        ]
      },
      orderBy: { expiresAt: "asc" },
      take: 100
    });

    let sent = 0;
    let failed = 0;
    for (const subscription of dueSubscriptions) {
      try {
        const claimAt = new Date();
        const claimed = await this.prisma.soldProductSubscription.updateMany({
          where: {
            id: subscription.id,
            active: true,
            renewalReminderSentAt: null,
            OR: [
              { renewalReminderClaimedAt: null },
              { renewalReminderClaimedAt: { lt: staleClaimBefore } }
            ]
          },
          data: { renewalReminderFor: subscription.expiresAt, renewalReminderClaimedAt: claimAt }
        });
        if (!claimed.count) continue;

        const delivered = await this.telegram.notifyAdminSubscriptionRenewal({
          productName: subscription.productName,
          customerName: subscription.customerName,
          zaloLink: subscription.zaloLink,
          accountNote: subscription.accountNote,
          expiresAt: subscription.expiresAt
        });
        if (!delivered) {
          await this.releaseFailedClaim(subscription.id, claimAt);
          failed += 1;
          continue;
        }
        const updated = await this.prisma.soldProductSubscription.updateMany({
          where: { id: subscription.id, active: true, renewalReminderClaimedAt: claimAt, renewalReminderSentAt: null },
          data: { renewalReminderSentAt: new Date() }
        });
        if (updated.count) {
          sent += 1;
          await this.audit(null, "SOLD_SUBSCRIPTION_RENEWAL_REMINDER_SENT", subscription.id, {
            expiresAt: subscription.expiresAt
          });
        }
      } catch (error) {
        // The stale-claim rule allows an interrupted worker to recover without
        // marking the reminder as sent.
        failed += 1;
        this.logger.warn(`Renewal reminder failed for subscription ${subscription.id}: ${(error as Error).message}`);
      }
    }
    if (sent || failed) this.logger.log(`Renewal reminders: ${sent} sent, ${failed} pending retry.`);
    return { checked: dueSubscriptions.length, sent, failed };
  }

  private async releaseFailedClaim(id: string, claimAt: Date) {
    await this.prisma.soldProductSubscription.updateMany({
      where: { id, renewalReminderClaimedAt: claimAt, renewalReminderSentAt: null },
      data: { renewalReminderFor: null, renewalReminderClaimedAt: null }
    });
  }

  private async requireProduct(productId: string) {
    const id = productId?.trim();
    if (!id) throw new BadRequestException("Hãy chọn sản phẩm.");
    const product = await this.prisma.product.findUnique({
      where: { id },
      select: { id: true, name: true }
    });
    if (!product) throw new BadRequestException("Sản phẩm đã chọn không tồn tại.");
    return product;
  }

  private audit(adminId: string | null, action: string, entityId: string, meta: Prisma.InputJsonValue) {
    return this.prisma.auditLog.create({
      data: { actorAdminId: adminId ?? undefined, action, entityType: "SoldProductSubscription", entityId, meta }
    });
  }
}

function normalizeInput(input: SoldProductSubscriptionInput) {
  return {
    productId: input.productId?.trim(),
    customerName: normalizeRequiredText(input.customerName, "Tên khách hàng"),
    zaloLink: normalizeZaloLink(input.zaloLink),
    startedAt: parseDateOnly(input.startDate, "Ngày bắt đầu"),
    durationMonths: normalizeDuration(input.durationMonths),
    accountNote: normalizeOptionalText(input.accountNote)
  };
}

function normalizeRequiredText(value: string, label: string) {
  const result = value?.trim();
  if (!result) throw new BadRequestException(`${label} không được để trống.`);
  return result.slice(0, 500);
}

function normalizeOptionalText(value: string | null | undefined) {
  const result = value?.trim();
  return result ? result.slice(0, 4_000) : null;
}

function normalizeZaloLink(value: string | null | undefined) {
  const link = normalizeOptionalText(value);
  if (!link) return null;
  try {
    const url = new URL(link);
    if (url.protocol !== "https:" && url.protocol !== "http:") throw new Error("Unsupported protocol");
    return url.toString();
  } catch {
    throw new BadRequestException("Link Zalo phải là đường dẫn http hoặc https hợp lệ.");
  }
}

function normalizeDuration(value: number) {
  const months = Number(value);
  if (!Number.isInteger(months) || months < 1 || months > 120) {
    throw new BadRequestException("Số tháng sử dụng phải từ 1 đến 120.");
  }
  return months;
}

function parseDateOnly(value: string, label: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value ?? "")) {
    throw new BadRequestException(`${label} không hợp lệ.`);
  }
  const date = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value) {
    throw new BadRequestException(`${label} không hợp lệ.`);
  }
  return date;
}

function addCalendarMonths(date: Date, months: number) {
  const year = date.getUTCFullYear();
  const month = date.getUTCMonth() + months;
  const day = date.getUTCDate();
  const lastDayOfTargetMonth = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  return new Date(Date.UTC(year, month, Math.min(day, lastDayOfTargetMonth)));
}

function vietnamCalendarDate(now: Date) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Ho_Chi_Minh",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(now);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return new Date(Date.UTC(Number(values.year), Number(values.month) - 1, Number(values.day)));
}
