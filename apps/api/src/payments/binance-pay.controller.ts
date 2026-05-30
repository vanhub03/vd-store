import { Body, Controller, Post, Req } from "@nestjs/common";
import { Request } from "express";
import { PaymentService } from "../domain/payment.service";

@Controller()
export class BinancePayController {
  constructor(private readonly payments: PaymentService) {}

  @Post("webhooks/binance-pay")
  async handleWebhook(@Req() request: Request & { rawBody?: Buffer }, @Body() body: Record<string, unknown>) {
    this.payments.verifyBinancePayRequest(request);
    const result = await this.payments.handleBinancePayWebhook(body);
    return { success: true, ...result };
  }
}
