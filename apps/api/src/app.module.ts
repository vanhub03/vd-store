import { Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { ScheduleModule } from "@nestjs/schedule";
import { AuthController } from "./auth/auth.controller";
import { AuthService } from "./auth/auth.service";
import { AdminController } from "./admin/admin.controller";
import { BotInternalController } from "./bot-internal/bot-internal.controller";
import { HealthController } from "./health.controller";
import { SepayController } from "./payments/sepay.controller";
import { BinancePayController } from "./payments/binance-pay.controller";
import { StoreController } from "./store/store.controller";
import { StoreService } from "./store/store.service";
import { PrismaService } from "./prisma.service";
import { ShopService } from "./domain/shop.service";
import { TelegramNotifyService } from "./domain/telegram-notify.service";
import { PaymentService } from "./domain/payment.service";
import { TaskService } from "./domain/task.service";
import { BroadcastService } from "./domain/broadcast.service";

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: [".env", "../../.env"]
    }),
    ScheduleModule.forRoot()
  ],
  controllers: [HealthController, AuthController, AdminController, BotInternalController, SepayController, BinancePayController, StoreController],
  providers: [
    PrismaService,
    AuthService,
    StoreService,
    ShopService,
    TelegramNotifyService,
    PaymentService,
    TaskService,
    BroadcastService
  ]
})
export class AppModule {}
