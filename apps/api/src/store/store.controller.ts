import { Body, Controller, Get, Param, Post, Req, UseGuards } from "@nestjs/common";
import { IsEmail, IsInt, IsOptional, IsString, Min, MinLength } from "class-validator";
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
  catalog() {
    return this.store.catalog();
  }

  @Get("products/:id")
  product(@Param("id") id: string) {
    return this.store.product(id);
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
    return this.store.purchaseWithWallet(request.customer!.telegramId, body.productId, body.quantity ?? 1);
  }

  @Post("orders/bank")
  @UseGuards(CustomerAuthGuard)
  buyWithBank(@Req() request: CustomerRequest, @Body() body: OrderDto) {
    return this.store.createBankOrder(request.customer!.telegramId, body.productId, body.quantity ?? 1);
  }
}
