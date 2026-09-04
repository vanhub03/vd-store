import { BadRequestException, Body, Controller, Delete, Get, Param, Post, Put, Query, Req, UseGuards } from "@nestjs/common";
import { CustomerRole, ManualOrderStatus, PartnerEnvironment, ProductDeliveryType, ProductStatus } from "@prisma/client";
import { ArrayMinSize, IsArray, IsBoolean, IsEmail, IsEnum, IsInt, IsNumber, IsOptional, IsString, Max, Min, MinLength } from "class-validator";
import { AdminAuthGuard, AdminRequest } from "../common/admin-auth.guard";
import { BroadcastService } from "../domain/broadcast.service";
import { ShopService, slugify } from "../domain/shop.service";
import { PrismaService } from "../prisma.service";
import { AnalyticsService } from "../analytics/analytics.service";
import { PartnerService } from "../partner/partner.service";
import { PartnerWebhookService } from "../partner/partner-webhook.service";
import { SoldProductSubscriptionService } from "../domain/sold-product-subscription.service";

class CategoryDto {
  @IsString()
  name!: string;

  @IsOptional()
  @IsString()
  nameEn?: string | null;

  @IsOptional()
  @IsString()
  slug?: string;

  @IsOptional()
  @IsInt()
  sortOrder?: number;
}

class ProductDto {
  @IsOptional()
  @IsString()
  categoryId?: string | null;

  @IsString()
  name!: string;

  @IsOptional()
  @IsString()
  nameEn?: string | null;

  @IsOptional()
  @IsString()
  slug?: string;

  @IsOptional()
  @IsString()
  description?: string | null;

  @IsOptional()
  @IsString()
  descriptionEn?: string | null;

  @IsOptional()
  @IsString()
  imageUrl?: string | null;

  @IsOptional()
  @IsString()
  buttonIcon?: string | null;

  @IsOptional()
  @IsInt()
  @Min(1)
  price?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  botPrice!: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  webPrice!: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  usdtPrice?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(90)
  collaboratorDiscountPercent?: number;

  @IsOptional()
  @IsBoolean()
  showInBot!: boolean;

  @IsOptional()
  @IsBoolean()
  showInWeb!: boolean;

  @IsOptional()
  @IsEnum(ProductStatus)
  status?: ProductStatus;

  @IsEnum(ProductDeliveryType)
  deliveryType!: ProductDeliveryType;

  @IsOptional()
  @IsString()
  sharedContent?: string | null;

  @IsOptional()
  @IsString()
  sharedFilePath?: string | null;

  @IsOptional()
  @IsString()
  manualInstructions?: string | null;

  @IsOptional()
  @IsInt()
  @Min(0)
  manualStock?: number;
}

class InventoryImportDto {
  @IsString()
  content!: string;
}

class WalletAdjustmentDto {
  @IsInt()
  amount!: number;

  @IsOptional()
  @IsString()
  note?: string;
}

class BroadcastDto {
  @IsString()
  title!: string;

  @IsString()
  message!: string;
}

class ManualOrderStatusDto {
  @IsEnum(ManualOrderStatus)
  status!: ManualOrderStatus;
}

class VoucherDto {
  @IsOptional()
  @IsString()
  code?: string;

  @IsInt()
  @Min(1)
  @Max(90)
  discountPercent!: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  maxDiscountAmount?: number | null;

  @IsOptional()
  @IsNumber()
  @Min(0.00000001)
  maxDiscountUsdt?: number | null;

  @IsOptional()
  @IsBoolean()
  active?: boolean;

  @IsOptional()
  @IsBoolean()
  firstOrderOnly?: boolean;

  @IsOptional()
  @IsBoolean()
  allowCollaboratorStacking?: boolean;

  @IsOptional()
  @IsInt()
  @Min(1)
  maxUses?: number | null;

  @IsOptional()
  @IsString()
  startsAt?: string | null;

  @IsOptional()
  @IsString()
  expiresAt?: string | null;
}

class VoucherAssignmentDto {
  @IsArray()
  @ArrayMinSize(1)
  @IsString({ each: true })
  userIds!: string[];
}

class CreateCollaboratorDto {
  @IsEmail()
  email!: string;

  @IsOptional()
  @IsString()
  displayName?: string;

  @IsString()
  @MinLength(6)
  password!: string;
}

class UpdateCollaboratorDto {
  @IsOptional()
  @IsEnum(CustomerRole)
  role?: CustomerRole;

  @IsOptional()
  @IsBoolean()
  isBlocked?: boolean;

  @IsOptional()
  @IsString()
  displayName?: string;

  @IsOptional()
  @IsString()
  @MinLength(6)
  password?: string;
}

class CreatePartnerApiKeyDto {
  @IsEnum(PartnerEnvironment)
  environment!: PartnerEnvironment;

  @IsOptional()
  @IsString()
  label?: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  scopes?: string[];

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(3650)
  expiresInDays?: number;
}

class PartnerApiSettingsDto {
  @IsOptional()
  @IsBoolean()
  enabled?: boolean;

  @IsOptional()
  @IsInt()
  readRateLimit?: number;

  @IsOptional()
  @IsInt()
  writeRateLimit?: number;
}

class PartnerWebhookDto {
  @IsEnum(PartnerEnvironment)
  environment!: PartnerEnvironment;

  @IsString()
  url!: string;

  @IsOptional()
  @IsBoolean()
  enabled?: boolean;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  events?: string[];

  @IsOptional()
  @IsBoolean()
  rotateSecret?: boolean;
}

class PartnerItemResolutionDto {
  @IsString()
  action!: "COMPLETED" | "CANCELLED";

  @IsOptional()
  @IsString()
  deliveryText?: string;
}

class UsdtRateDto {
  @IsNumber()
  @Min(1)
  rate!: number;
}

class SoldProductSubscriptionDto {
  @IsOptional()
  @IsString()
  productId?: string | null;

  @IsString()
  productName!: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  saleAmount?: number | null;

  @IsString()
  customerName!: string;

  @IsOptional()
  @IsString()
  zaloLink?: string | null;

  @IsString()
  startDate!: string;

  @IsInt()
  @Min(1)
  @Max(120)
  durationMonths!: number;

  @IsOptional()
  @IsString()
  accountNote?: string | null;
}

class UpdateSoldProductSubscriptionDto {
  @IsOptional()
  @IsString()
  productId?: string | null;

  @IsOptional()
  @IsString()
  productName?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  saleAmount?: number | null;

  @IsOptional()
  @IsString()
  customerName?: string;

  @IsOptional()
  @IsString()
  zaloLink?: string | null;

  @IsOptional()
  @IsString()
  startDate?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(120)
  durationMonths?: number;

  @IsOptional()
  @IsString()
  accountNote?: string | null;

  @IsOptional()
  @IsBoolean()
  active?: boolean;
}

class RenewSoldProductSubscriptionDto {
  @IsInt()
  @Min(1)
  @Max(120)
  durationMonths!: number;
}

@Controller("admin")
@UseGuards(AdminAuthGuard)
export class AdminController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly shop: ShopService,
    private readonly broadcasts: BroadcastService,
    private readonly analytics: AnalyticsService,
    private readonly partners: PartnerService,
    private readonly partnerWebhooks: PartnerWebhookService,
    private readonly soldSubscriptions: SoldProductSubscriptionService
  ) {}

  @Get("stats")
  stats() {
    return this.shop.getStats();
  }

  @Get("dashboard")
  dashboard() {
    return this.shop.getDashboard();
  }

  @Get("analytics/overview")
  analyticsOverview(@Query("range") range?: string, @Query("refresh") refresh?: string) {
    return this.analytics.overview(range, refresh === "1");
  }

  @Get("analytics/realtime")
  analyticsRealtime(@Query("refresh") refresh?: string) {
    return this.analytics.realtime(refresh === "1");
  }

  @Get("users")
  users(@Query("take") take?: string, @Query("skip") skip?: string, @Query("search") search?: string) {
    return this.shop.listAdminUsers({ take, skip, search });
  }

  @Get("collaborators")
  collaborators(
    @Query("search") search?: string,
    @Query("status") status?: string,
    @Query("createdFrom") createdFrom?: string,
    @Query("createdTo") createdTo?: string
  ) {
    return this.shop.listCollaborators({ search, status, createdFrom, createdTo });
  }

  @Get("collaborators/report")
  collaboratorReport() {
    return this.shop.getCollaboratorReport();
  }

  @Post("collaborators")
  createCollaborator(@Req() request: AdminRequest, @Body() body: CreateCollaboratorDto) {
    return this.shop.createCollaborator(request.admin!.id, body);
  }

  @Put("collaborators/:id")
  updateCollaborator(@Req() request: AdminRequest, @Param("id") userId: string, @Body() body: UpdateCollaboratorDto) {
    return this.shop.updateCollaborator(request.admin!.id, userId, body);
  }

  @Get("collaborators/:id/api-keys")
  partnerApiKeys(@Param("id") userId: string) {
    return this.partners.listCredentials(userId);
  }

  @Post("collaborators/:id/api-keys")
  createPartnerApiKey(@Req() request: AdminRequest, @Param("id") userId: string, @Body() body: CreatePartnerApiKeyDto) {
    return this.partners.createCredential(request.admin!.id, userId, body);
  }

  @Delete("collaborators/:id/api-keys/:credentialId")
  revokePartnerApiKey(@Req() request: AdminRequest, @Param("id") userId: string, @Param("credentialId") credentialId: string) {
    return this.partners.revokeCredential(request.admin!.id, userId, credentialId);
  }

  @Put("collaborators/:id/api-settings")
  updatePartnerApiSettings(@Req() request: AdminRequest, @Param("id") userId: string, @Body() body: PartnerApiSettingsDto) {
    return this.partners.updateApiSettings(request.admin!.id, userId, body);
  }

  @Get("collaborators/:id/webhooks")
  partnerWebhooksForUser(@Param("id") userId: string) {
    return this.partnerWebhooks.listEndpoints(userId);
  }

  @Put("collaborators/:id/webhooks")
  configurePartnerWebhook(@Req() request: AdminRequest, @Param("id") userId: string, @Body() body: PartnerWebhookDto) {
    return this.partners.configureWebhook(request.admin!.id, userId, body);
  }

  @Post("collaborators/:id/webhooks/:environment/test")
  testPartnerWebhook(@Param("id") userId: string, @Param("environment") environment: PartnerEnvironment) {
    return this.partnerWebhooks.sendTest(userId, environment);
  }

  @Get("collaborators/:id/webhook-deliveries")
  partnerWebhookDeliveries(@Param("id") userId: string) {
    return this.partnerWebhooks.listDeliveries(userId);
  }

  @Get("partner-orders")
  partnerOrders(@Query("take") take?: string) {
    return this.prisma.partnerOrder.findMany({
      orderBy: { createdAt: "desc" },
      take: Math.min(200, Math.max(1, Number(take ?? 100))),
      include: {
        user: { select: { id: true, telegramId: true, email: true, displayName: true, role: true, isBlocked: true, createdAt: true } },
        items: { orderBy: { createdAt: "asc" } }
      }
    });
  }

  @Post("partner-order-items/:id/resolve")
  resolvePartnerOrderItem(@Req() request: AdminRequest, @Param("id") itemId: string, @Body() body: PartnerItemResolutionDto) {
    if (!["COMPLETED", "CANCELLED"].includes(body.action)) throw new BadRequestException("Invalid partner item action.");
    return this.partners.fulfillItem(request.admin!.id, itemId, body.action, body.deliveryText);
  }

  @Get("settings/usdt-vnd-rate")
  async usdtVndRate() {
    const setting = await this.prisma.storeSetting.findUnique({ where: { key: "USDT_VND_RATE" } });
    return { rate: Number(setting?.value ?? process.env.USDT_VND_RATE ?? 0), updatedAt: setting?.updatedAt ?? null };
  }

  @Put("settings/usdt-vnd-rate")
  async updateUsdtVndRate(@Req() request: AdminRequest, @Body() body: UsdtRateDto) {
    const setting = await this.prisma.storeSetting.upsert({
      where: { key: "USDT_VND_RATE" },
      update: { value: String(body.rate), updatedByAdminId: request.admin!.id },
      create: { key: "USDT_VND_RATE", value: String(body.rate), updatedByAdminId: request.admin!.id }
    });
    await this.prisma.auditLog.create({ data: { actorAdminId: request.admin!.id, action: "USDT_VND_RATE_UPDATE", entityType: "StoreSetting", entityId: setting.key, meta: { rate: body.rate } } });
    return { rate: Number(setting.value), updatedAt: setting.updatedAt };
  }

  @Post("users/:id/wallet-adjustments")
  adjustWallet(@Req() request: AdminRequest, @Param("id") userId: string, @Body() body: WalletAdjustmentDto) {
    return this.shop.adjustWallet(request.admin!.id, userId, body.amount, body.note);
  }

  @Get("categories")
  categories() {
    return this.prisma.category.findMany({ orderBy: [{ sortOrder: "asc" }, { name: "asc" }] });
  }

  @Post("categories")
  async createCategory(@Req() request: AdminRequest, @Body() body: CategoryDto) {
    const category = await this.prisma.category.create({
      data: {
        name: body.name.trim(),
        slug: body.slug ? slugify(body.slug) : slugify(body.name),
        sortOrder: body.sortOrder ?? 0
      }
    });
    await this.prisma.auditLog.create({
      data: {
        actorAdminId: request.admin!.id,
        action: "CATEGORY_CREATE",
        entityType: "Category",
        entityId: category.id,
        meta: { name: category.name }
      }
    });
    this.shop.clearCatalogCache();
    return category;
  }

  @Get("products")
  products(@Query("take") take?: string, @Query("skip") skip?: string) {
    return this.shop.listProducts({ take, skip });
  }

  @Get("sold-product-subscriptions")
  soldProductSubscriptions() {
    return this.soldSubscriptions.list();
  }

  @Post("sold-product-subscriptions")
  createSoldProductSubscription(@Req() request: AdminRequest, @Body() body: SoldProductSubscriptionDto) {
    return this.soldSubscriptions.create(request.admin!.id, body);
  }

  @Put("sold-product-subscriptions/:id")
  updateSoldProductSubscription(@Req() request: AdminRequest, @Param("id") id: string, @Body() body: UpdateSoldProductSubscriptionDto) {
    return this.soldSubscriptions.update(request.admin!.id, id, body);
  }

  @Post("sold-product-subscriptions/:id/renew")
  renewSoldProductSubscription(@Req() request: AdminRequest, @Param("id") id: string, @Body() body: RenewSoldProductSubscriptionDto) {
    return this.soldSubscriptions.renew(request.admin!.id, id, body.durationMonths);
  }

  @Delete("sold-product-subscriptions/:id")
  deactivateSoldProductSubscription(@Req() request: AdminRequest, @Param("id") id: string) {
    return this.soldSubscriptions.deactivate(request.admin!.id, id);
  }

  @Post("sold-product-subscriptions/reminders/run")
  runSoldProductSubscriptionReminders() {
    return this.soldSubscriptions.dispatchDueRenewalReminders();
  }

  @Post("products")
  createProduct(@Req() request: AdminRequest, @Body() body: ProductDto) {
    return this.shop.createProduct(body, request.admin!.id);
  }

  @Put("products/:id")
  updateProduct(@Req() request: AdminRequest, @Param("id") id: string, @Body() body: Partial<ProductDto>) {
    return this.shop.updateProduct(id, body, request.admin!.id);
  }

  @Delete("products/:id")
  updateProductStatus(@Req() request: AdminRequest, @Param("id") id: string) {
    return this.shop.updateProduct(id, { status: ProductStatus.INACTIVE }, request.admin!.id);
  }

  @Post("products/:id/inventory/import")
  importInventory(@Req() request: AdminRequest, @Param("id") id: string, @Body() body: InventoryImportDto) {
    return this.shop.importInventory(id, body.content.split(/\r?\n/), request.admin!.id);
  }

  @Get("products/:id/inventory")
  inventoryItems(@Param("id") id: string) {
    return this.shop.listInventoryItems(id);
  }

  @Delete("products/:id/inventory/:itemId")
  deleteInventoryItem(@Req() request: AdminRequest, @Param("id") id: string, @Param("itemId") itemId: string) {
    return this.shop.deleteInventoryItem(id, itemId, request.admin!.id);
  }

  @Get("orders")
  orders(@Query("take") take?: string, @Query("skip") skip?: string) {
    return this.shop.listOrders({ take, skip });
  }

  @Post("orders/:id/manual-status")
  updateManualOrderStatus(@Req() request: AdminRequest, @Param("id") id: string, @Body() body: ManualOrderStatusDto) {
    return this.shop.updateManualOrderStatus(request.admin!.id, id, body.status);
  }

  @Get("payments")
  payments(@Query("take") take?: string, @Query("skip") skip?: string) {
    return this.shop.listPayments({ take, skip });
  }

  @Get("vouchers")
  vouchers(@Query("take") take?: string, @Query("skip") skip?: string) {
    return this.shop.listVouchers({ take, skip });
  }

  @Post("vouchers")
  createVoucher(@Req() request: AdminRequest, @Body() body: VoucherDto) {
    return this.shop.createVoucher(body, request.admin!.id);
  }

  @Put("vouchers/:id")
  updateVoucher(@Req() request: AdminRequest, @Param("id") id: string, @Body() body: Partial<VoucherDto>) {
    return this.shop.updateVoucher(id, body, request.admin!.id);
  }

  @Get("vouchers/:id/assignments")
  voucherAssignments(@Param("id") id: string) {
    return this.shop.listVoucherAssignments(id);
  }

  @Post("vouchers/:id/assignments")
  assignVoucher(@Req() request: AdminRequest, @Param("id") id: string, @Body() body: VoucherAssignmentDto) {
    return this.shop.assignVoucherToUsers(request.admin!.id, id, body.userIds);
  }

  @Delete("vouchers/:id/assignments/:assignmentId")
  revokeVoucherAssignment(@Req() request: AdminRequest, @Param("id") id: string, @Param("assignmentId") assignmentId: string) {
    return this.shop.revokeVoucherAssignment(request.admin!.id, id, assignmentId);
  }

  @Get("broadcasts")
  listBroadcasts() {
    return this.broadcasts.listBroadcasts();
  }

  @Post("broadcasts")
  createBroadcast(@Req() request: AdminRequest, @Body() body: BroadcastDto) {
    return this.broadcasts.createBroadcast(request.admin!.id, body.title, body.message);
  }

  @Post("broadcasts/:id/send")
  sendBroadcast(@Param("id") id: string) {
    return this.broadcasts.queueBroadcast(id);
  }
}
