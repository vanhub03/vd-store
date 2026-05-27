import { Body, Controller, Delete, Get, Param, Post, Put, Req, UseGuards } from "@nestjs/common";
import { ProductDeliveryType, ProductStatus } from "@prisma/client";
import { IsEnum, IsInt, IsOptional, IsString, Min } from "class-validator";
import { AdminAuthGuard, AdminRequest } from "../common/admin-auth.guard";
import { BroadcastService } from "../domain/broadcast.service";
import { ShopService, slugify } from "../domain/shop.service";
import { PrismaService } from "../prisma.service";

class CategoryDto {
  @IsString()
  name!: string;

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
  slug?: string;

  @IsOptional()
  @IsString()
  description?: string | null;

  @IsOptional()
  @IsString()
  imageUrl?: string | null;

  @IsInt()
  @Min(1)
  price!: number;

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

@Controller("admin")
@UseGuards(AdminAuthGuard)
export class AdminController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly shop: ShopService,
    private readonly broadcasts: BroadcastService
  ) {}

  @Get("stats")
  stats() {
    return this.shop.getStats();
  }

  @Get("dashboard")
  dashboard() {
    return this.shop.getDashboard();
  }

  @Get("users")
  users() {
    return this.shop.listAdminUsers();
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
    return category;
  }

  @Get("products")
  products() {
    return this.shop.listProducts();
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

  @Get("orders")
  orders() {
    return this.shop.listOrders();
  }

  @Get("payments")
  payments() {
    return this.shop.listPayments();
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
