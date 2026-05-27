import { Body, Controller, Get, Param, Post, UseGuards } from "@nestjs/common";
import { IsInt, IsOptional, IsString, Min } from "class-validator";
import { BotInternalGuard } from "../common/bot-internal.guard";
import { ShopService } from "../domain/shop.service";

class UpsertUserDto {
  @IsString()
  telegramId!: string;

  @IsOptional()
  @IsString()
  username?: string;

  @IsOptional()
  @IsString()
  firstName?: string;

  @IsOptional()
  @IsString()
  lastName?: string;

  @IsOptional()
  @IsString()
  languageCode?: string;
}

class TopupDto {
  @IsString()
  telegramId!: string;

  @IsInt()
  @Min(1)
  amount!: number;
}

class OrderDto {
  @IsString()
  telegramId!: string;

  @IsString()
  productId!: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  quantity?: number;
}

class PaymentMessageDto {
  @IsString()
  telegramChatId!: string;

  @IsInt()
  telegramMessageId!: number;
}

@Controller("bot")
@UseGuards(BotInternalGuard)
export class BotInternalController {
  constructor(private readonly shop: ShopService) {}

  @Post("users/upsert")
  upsertUser(@Body() body: UpsertUserDto) {
    return this.shop.upsertTelegramUser(body);
  }

  @Get("catalog")
  catalog() {
    return this.shop.getCatalog();
  }

  @Get("products/:id")
  product(@Param("id") id: string) {
    return this.shop.getProduct(id);
  }

  @Get("wallet/:telegramId")
  wallet(@Param("telegramId") telegramId: string) {
    return this.shop.getWalletBalanceByTelegramId(telegramId).then((balance) => ({ balance }));
  }

  @Get("history/:telegramId")
  history(@Param("telegramId") telegramId: string) {
    return this.shop.getHistory(telegramId);
  }

  @Post("topups")
  createTopup(@Body() body: TopupDto) {
    return this.shop.createTopup(body.telegramId, body.amount);
  }

  @Post("orders/wallet")
  purchaseWithWallet(@Body() body: OrderDto) {
    return this.shop.purchaseWithWallet(body.telegramId, body.productId, body.quantity ?? 1);
  }

  @Post("orders/bank")
  createBankOrder(@Body() body: OrderDto) {
    return this.shop.createBankOrder(body.telegramId, body.productId, body.quantity ?? 1);
  }

  @Post("payments/:id/telegram-message")
  recordPaymentMessage(@Param("id") id: string, @Body() body: PaymentMessageDto) {
    return this.shop.recordPaymentTelegramMessage(id, body.telegramChatId, body.telegramMessageId);
  }
}
