import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { PrismaClient } from "@prisma/client";

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PrismaService.name);

  async onModuleInit() {
    await this.$connect();
  }

  async onModuleDestroy() {
    await this.$disconnect();
  }

  async withConnectionRetry<T>(operation: () => Promise<T>, label: string) {
    const attempts = 2;
    let lastError: unknown;

    for (let attempt = 1; attempt <= attempts; attempt += 1) {
      try {
        return await operation();
      } catch (error) {
        lastError = error;
        if (attempt === attempts || !isRetryableConnectionError(error)) {
          throw error;
        }

        this.logger.warn(`Retrying ${label} after database connection error.`);
        await this.resetConnection();
        await delay(500);
      }
    }

    throw lastError;
  }

  private async resetConnection() {
    try {
      await this.$disconnect();
    } catch {
      // Ignore disconnect failures; the next connect attempt is the recovery path.
    }
    await this.$connect();
  }
}

function isRetryableConnectionError(error: unknown) {
  if (!error || typeof error !== "object") return false;
  const code = "code" in error ? String(error.code) : "";
  const message = "message" in error ? String(error.message) : "";
  return code === "P1001" || code === "P1017" || message.includes("Engine is not yet connected");
}

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
