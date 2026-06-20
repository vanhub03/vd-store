import { ArrayMaxSize, ArrayMinSize, IsArray, IsInt, IsOptional, IsString, Max, MaxLength, Min, MinLength, ValidateNested } from "class-validator";
import { Type } from "class-transformer";
import { Body, Controller, Get, Headers, HttpCode, Param, Post, Query, Req, UseFilters, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiHeader, ApiOperation, ApiProperty, ApiPropertyOptional, ApiTags } from "@nestjs/swagger";
import { PartnerAuthGuard, PartnerRateLimitGuard, PartnerRequest, PartnerScope } from "./partner-auth.guard";
import { PartnerProblemFilter } from "./partner-problem.filter";
import { PartnerService } from "./partner.service";

class PartnerOrderItemDto {
  @ApiProperty({ example: "cm123product" })
  @IsString()
  @MinLength(1)
  productId!: string;

  @ApiProperty({ example: 1, minimum: 1, maximum: 999 })
  @IsInt()
  @Min(1)
  @Max(999)
  quantity!: number;
}

class CreatePartnerOrderDto {
  @ApiProperty({ example: "shop-order-2026-0001", maxLength: 100 })
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  externalOrderId!: string;

  @ApiProperty({ type: [PartnerOrderItemDto], maxItems: 20 })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(20)
  @ValidateNested({ each: true })
  @Type(() => PartnerOrderItemDto)
  items!: PartnerOrderItemDto[];

  @ApiPropertyOptional({ example: "CTV10" })
  @IsOptional()
  @IsString()
  @MaxLength(32)
  voucherCode?: string;
}

@ApiTags("Partner API")
@ApiBearerAuth()
@Controller("partner/v1")
@UseGuards(PartnerAuthGuard, PartnerRateLimitGuard)
@UseFilters(PartnerProblemFilter)
export class PartnerController {
  constructor(private readonly partnerService: PartnerService) {}

  @Get("catalog")
  @PartnerScope("catalog:read")
  @ApiOperation({ summary: "List products with collaborator pricing" })
  catalog(@Req() request: PartnerRequest) {
    return this.partnerService.catalog(request.partner!.environment);
  }

  @Get("balance")
  @PartnerScope("balance:read")
  @ApiOperation({ summary: "Get collaborator wallet balance" })
  balance(@Req() request: PartnerRequest) {
    return this.partnerService.balance(request.partner!.user.id, request.partner!.environment);
  }

  @Post("orders")
  @HttpCode(201)
  @PartnerScope("orders:write")
  @ApiHeader({ name: "Idempotency-Key", required: true, description: "Unique key retained for 24 hours" })
  @ApiOperation({ summary: "Create and pay a partner order from the collaborator wallet" })
  createOrder(@Req() request: PartnerRequest, @Headers("idempotency-key") idempotencyKey: string | undefined, @Body() body: CreatePartnerOrderDto) {
    return this.partnerService.createOrder({
      userId: request.partner!.user.id,
      environment: request.partner!.environment,
      idempotencyKey: idempotencyKey?.trim() ?? "",
      externalOrderId: body.externalOrderId.trim(),
      items: body.items,
      voucherCode: body.voucherCode
    });
  }

  @Get("orders")
  @PartnerScope("orders:read")
  @ApiOperation({ summary: "List partner orders with cursor pagination" })
  listOrders(@Req() request: PartnerRequest, @Query("cursor") cursor?: string, @Query("limit") limit?: string) {
    return this.partnerService.listOrders(request.partner!.user.id, request.partner!.environment, cursor, Number(limit ?? 50));
  }

  @Get("orders/:id")
  @PartnerScope("orders:read")
  @ApiOperation({ summary: "Retrieve a partner order" })
  getOrder(@Req() request: PartnerRequest, @Param("id") id: string) {
    return this.partnerService.getOrder(request.partner!.user.id, request.partner!.environment, id);
  }
}
