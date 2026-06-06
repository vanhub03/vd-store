import { Controller, Get } from "@nestjs/common";
import { PrismaService } from "./prisma.service";

@Controller()
export class HealthController {
  constructor(private readonly prisma: PrismaService) {}

  @Get("health")
  async health() {
    await this.prisma.healthCheck();
    return {
      ok: true,
      service: "vd-store-api",
      timestamp: new Date().toISOString()
    };
  }
}
