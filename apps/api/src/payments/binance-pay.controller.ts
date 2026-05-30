import { Body, Controller, Post } from "@nestjs/common";
import { PaymentService } from "../domain/payment.service";

@Controller()
export class BinancePayController {
  constructor(private readonly payments: PaymentService) {}

  @Post("webhooks/binance-pay")
  async handleWebhook(@Body() body: Record<string, unknown>) {
    const result = await this.payments.handleBinancePayWebhook(body);
    return { success: true, ...result };
  }
}
