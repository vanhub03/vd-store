import { Body, Controller, Headers, Post, Req } from "@nestjs/common";
import { Request } from "express";
import { PaymentService } from "../domain/payment.service";

@Controller("webhooks/sepay")
export class SepayController {
  constructor(private readonly payments: PaymentService) {}

  @Post()
  async handle(@Req() request: Request & { rawBody?: Buffer }, @Body() body: Record<string, unknown>, @Headers() _headers: Record<string, string>) {
    this.payments.verifySepayRequest(request);
    const result = await this.payments.handleSepayWebhook(body);
    return { success: true, ...result };
  }
}
