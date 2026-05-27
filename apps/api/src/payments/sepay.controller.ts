import { Body, Controller, Headers, Post, Req } from "@nestjs/common";
import { Request } from "express";
import { PaymentService } from "../domain/payment.service";

@Controller()
export class SepayController {
  constructor(private readonly payments: PaymentService) {}

  @Post("webhooks/sepay")
  handleWebhook(@Req() request: Request & { rawBody?: Buffer }, @Body() body: Record<string, unknown>, @Headers() headers: Record<string, string>) {
    return this.handle(request, body, headers);
  }

  @Post("hooks/sepay-payment")
  handlePaymentHook(@Req() request: Request & { rawBody?: Buffer }, @Body() body: Record<string, unknown>, @Headers() headers: Record<string, string>) {
    return this.handle(request, body, headers);
  }

  @Post("hooks/sepay")
  handleShortHook(@Req() request: Request & { rawBody?: Buffer }, @Body() body: Record<string, unknown>, @Headers() headers: Record<string, string>) {
    return this.handle(request, body, headers);
  }

  private async handle(request: Request & { rawBody?: Buffer }, body: Record<string, unknown>, _headers: Record<string, string>) {
    this.payments.verifySepayRequest(request);
    const result = await this.payments.handleSepayWebhook(body);
    return { success: true, ...result };
  }
}
