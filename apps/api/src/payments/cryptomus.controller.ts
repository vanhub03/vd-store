import { Body, Controller, Post, Req } from "@nestjs/common";
import { Request } from "express";
import { PaymentService } from "../domain/payment.service";

@Controller()
export class CryptomusController {
  constructor(private readonly payments: PaymentService) {}

  @Post("webhooks/cryptomus")
  async handleWebhook(@Req() request: Request & { rawBody?: Buffer }, @Body() body: Record<string, unknown>) {
    this.payments.verifyCryptomusRequest(request, body);
    const result = await this.payments.handleCryptomusWebhook(body);
    return { success: true, ...result };
  }
}
