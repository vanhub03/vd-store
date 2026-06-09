import { Body, Controller, Get, Header, Param, Post, Req, UseGuards } from "@nestjs/common";
import { ArrayMaxSize, ArrayMinSize, IsArray, IsEmail, IsInt, IsOptional, IsString, Max, Min, MinLength } from "class-validator";
import crypto from "node:crypto";
import { CustomerAuthGuard, CustomerRequest } from "../common/customer-auth.guard";
import { StoreService } from "./store.service";

class RegisterDto {
  @IsEmail()
  email!: string;

  @IsString()
  @MinLength(6)
  password!: string;

  @IsOptional()
  @IsString()
  name?: string;
}

class LoginDto {
  @IsEmail()
  email!: string;

  @IsString()
  @MinLength(6)
  password!: string;
}

class TopupDto {
  @IsInt()
  @Min(1000)
  amount!: number;
}

class OrderDto {
  @IsString()
  productId!: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  quantity?: number;

  @IsOptional()
  @IsString()
  voucherCode?: string;
}

class VoucherPreviewDto {
  @IsString()
  productId!: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  quantity?: number;

  @IsString()
  voucherCode!: string;
}

class CartOrderDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(20)
  items!: Array<{ productId: string; quantity: number }>;

  @IsOptional()
  @IsString()
  voucherCode?: string;
}

class ReviewDto {
  @IsString()
  productId!: string;

  @IsInt()
  @Min(1)
  @Max(5)
  rating!: number;

  @IsOptional()
  @IsString()
  title?: string;

  @IsString()
  @MinLength(8)
  content!: string;
}

@Controller("store")
export class StoreController {
  constructor(private readonly store: StoreService) {}

  @Post("auth/register")
  register(@Body() body: RegisterDto) {
    return this.store.register(body.email, body.password, body.name);
  }

  @Post("auth/login")
  login(@Body() body: LoginDto) {
    return this.store.login(body.email, body.password);
  }

  @Get("me")
  @UseGuards(CustomerAuthGuard)
  me(@Req() request: CustomerRequest) {
    return this.store.profile(request.customer!.id);
  }

  @Get("catalog")
  @Header("Cache-Control", "no-store")
  catalog() {
    return this.store.catalog();
  }

  @Get("member/catalog")
  @UseGuards(CustomerAuthGuard)
  @Header("Cache-Control", "no-store")
  memberCatalog(@Req() request: CustomerRequest) {
    return this.store.memberCatalog(request.customer!.id);
  }

  @Get("reviews")
  @Header("Cache-Control", "no-store")
  reviews() {
    return this.store.reviews();
  }

  @Get("products/:id")
  @Header("Cache-Control", "no-store")
  product(@Param("id") id: string) {
    return this.store.product(id);
  }

  @Get("member/products/:id")
  @UseGuards(CustomerAuthGuard)
  @Header("Cache-Control", "no-store")
  memberProduct(@Req() request: CustomerRequest, @Param("id") id: string) {
    return this.store.memberProduct(request.customer!.id, id);
  }

  @Get("wallet")
  @UseGuards(CustomerAuthGuard)
  wallet(@Req() request: CustomerRequest) {
    return this.store.wallet(request.customer!.id);
  }

  @Get("history")
  @UseGuards(CustomerAuthGuard)
  history(@Req() request: CustomerRequest) {
    return this.store.history(request.customer!.telegramId);
  }

  @Get("payments/:code")
  @UseGuards(CustomerAuthGuard)
  paymentStatus(@Req() request: CustomerRequest, @Param("code") code: string) {
    return this.store.paymentStatus(request.customer!.id, code);
  }

  @Post("topups")
  @UseGuards(CustomerAuthGuard)
  topup(@Req() request: CustomerRequest, @Body() body: TopupDto) {
    return this.store.createTopup(request.customer!.telegramId, body.amount);
  }

  @Post("orders/wallet")
  @UseGuards(CustomerAuthGuard)
  buyWithWallet(@Req() request: CustomerRequest, @Body() body: OrderDto) {
    return this.store.purchaseWithWallet(request.customer!.telegramId, body.productId, body.quantity ?? 1, body.voucherCode, voucherClaimFromRequest(request));
  }

  @Post("orders/bank")
  @UseGuards(CustomerAuthGuard)
  buyWithBank(@Req() request: CustomerRequest, @Body() body: OrderDto) {
    return this.store.createBankOrder(request.customer!.telegramId, body.productId, body.quantity ?? 1, body.voucherCode, voucherClaimFromRequest(request));
  }

  @Post("orders/usdt")
  @UseGuards(CustomerAuthGuard)
  buyWithUsdt(@Req() request: CustomerRequest, @Body() body: OrderDto) {
    return this.store.createUsdtOrder(request.customer!.telegramId, body.productId, body.quantity ?? 1, body.voucherCode, voucherClaimFromRequest(request));
  }

  @Post("vouchers/preview")
  @UseGuards(CustomerAuthGuard)
  previewVoucher(@Req() request: CustomerRequest, @Body() body: VoucherPreviewDto) {
    return this.store.previewVoucher(request.customer!.telegramId, body.productId, body.quantity ?? 1, body.voucherCode, voucherClaimFromRequest(request));
  }

  @Post("cart/orders/wallet")
  @UseGuards(CustomerAuthGuard)
  buyCartWithWallet(@Req() request: CustomerRequest, @Body() body: CartOrderDto) {
    return this.store.purchaseCartWithWallet(request.customer!.telegramId, body.items, body.voucherCode, voucherClaimFromRequest(request));
  }

  @Post("cart/orders/bank")
  @UseGuards(CustomerAuthGuard)
  buyCartWithBank(@Req() request: CustomerRequest, @Body() body: CartOrderDto) {
    return this.store.createCartBankOrder(request.customer!.telegramId, body.items, body.voucherCode, voucherClaimFromRequest(request));
  }

  @Post("cart/orders/usdt")
  @UseGuards(CustomerAuthGuard)
  buyCartWithUsdt(@Req() request: CustomerRequest, @Body() body: CartOrderDto) {
    return this.store.createCartUsdtOrder(request.customer!.telegramId, body.items, body.voucherCode, voucherClaimFromRequest(request));
  }

  @Post("cart/vouchers/preview")
  @UseGuards(CustomerAuthGuard)
  previewCartVoucher(@Req() request: CustomerRequest, @Body() body: CartOrderDto & { voucherCode: string }) {
    return this.store.previewCartVoucher(request.customer!.telegramId, body.items, body.voucherCode, voucherClaimFromRequest(request));
  }

  @Post("reviews")
  @UseGuards(CustomerAuthGuard)
  createReview(@Req() request: CustomerRequest, @Body() body: ReviewDto) {
    return this.store.createReview(request.customer!.id, body);
  }
}

function voucherClaimFromRequest(request: CustomerRequest) {
  const ip = normalizeIp(firstHeader(request.headers["cf-connecting-ip"]) ?? firstHeader(request.headers["x-real-ip"]) ?? firstForwardedIp(request) ?? request.ip ?? request.socket.remoteAddress);
  const userAgent = firstHeader(request.headers["user-agent"])?.slice(0, 240) ?? "unknown";
  const fingerprintSource = `${ip ?? "unknown-ip"}|${userAgent}`;
  return {
    ipHash: ip ? hashVoucherClaim(ip) : null,
    fingerprintHash: hashVoucherClaim(fingerprintSource)
  };
}

function firstForwardedIp(request: CustomerRequest) {
  return firstHeader(request.headers["x-forwarded-for"])?.split(",")[0]?.trim();
}

function firstHeader(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

function normalizeIp(value?: string | null) {
  return value?.trim().replace(/^::ffff:/, "") || null;
}

function hashVoucherClaim(value: string) {
  const secret = process.env.VOUCHER_FINGERPRINT_SECRET ?? process.env.JWT_SECRET ?? "dev-secret";
  return crypto.createHmac("sha256", secret).update(value).digest("hex");
}
