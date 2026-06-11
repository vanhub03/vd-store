import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { PrismaClient } from "@prisma/client";

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PrismaService.name);
  private readonly keepAliveMs = Number(process.env.PRISMA_KEEPALIVE_MS ?? 30_000);
  private keepAliveTimer: NodeJS.Timeout | null = null;
  private resetPromise: Promise<void> | null = null;
  private restartScheduled = false;

  async onModuleInit() {
    await this.$connect();
    this.startKeepAlive();
  }

  async onModuleDestroy() {
    if (this.keepAliveTimer) {
      clearInterval(this.keepAliveTimer);
      this.keepAliveTimer = null;
    }
    await this.$disconnect();
  }

  async withConnectionRetry<T>(operation: () => Promise<T>, label: string) {
    const attempts = 3;
    let lastError: unknown;

    for (let attempt = 1; attempt <= attempts; attempt += 1) {
      try {
        return await operation();
      } catch (error) {
        lastError = error;
        const retryable = isRetryableConnectionError(error);
        if (!retryable) {
          throw error;
        }
        if (attempt === attempts) {
          if (!isConnectionPoolTimeout(error)) {
            this.scheduleRestart(`Prisma engine did not recover while running ${label}.`);
          }
          throw error;
        }

        this.logger.warn(`Retrying ${label} after database connection error. Attempt ${attempt}/${attempts}.`);
        if (!isConnectionPoolTimeout(error)) {
          await this.resetConnection();
        }
        await delay(isConnectionPoolTimeout(error) ? 750 * attempt : 400 * attempt);
      }
    }

    throw lastError;
  }

  healthCheck() {
    return this.withConnectionRetry(() => this.$queryRawUnsafe("SELECT 1"), "health check");
  }

  private async resetConnection() {
    if (!this.resetPromise) {
      this.resetPromise = this.forceResetConnection().finally(() => {
        this.resetPromise = null;
      });
    }
    await this.resetPromise;
  }

  private async forceResetConnection() {
    try {
      await this.$connect();
    } catch (error) {
      this.logger.error(`Prisma reconnect failed: ${errorMessage(error)}`);
      this.scheduleRestart("Prisma reconnect failed.");
      throw error;
    }
  }

  private startKeepAlive() {
    if (!Number.isFinite(this.keepAliveMs) || this.keepAliveMs <= 0) return;
    this.keepAliveTimer = setInterval(() => {
      this.healthCheck().catch((error) => {
        this.logger.error(`Prisma keepalive failed: ${errorMessage(error)}`);
        if (isRetryableConnectionError(error)) {
          this.scheduleRestart("Prisma keepalive could not recover the engine.");
        }
      });
    }, this.keepAliveMs);
    this.keepAliveTimer.unref?.();
  }

  private scheduleRestart(reason: string) {
    if (this.restartScheduled) return;
    this.restartScheduled = true;
    this.logger.error(`${reason} Exiting so systemd can restart the API.`);
    setTimeout(() => process.exit(1), 100).unref?.();
  }
}

function isRetryableConnectionError(error: unknown) {
  if (!error || typeof error !== "object") return false;
  const code = "code" in error ? String(error.code) : "";
  const message = "message" in error ? String(error.message) : "";
  return code === "P1001" || code === "P1017" || code === "P2024" || message.includes("Engine is not yet connected");
}

function isConnectionPoolTimeout(error: unknown) {
  return Boolean(error && typeof error === "object" && "code" in error && String(error.code) === "P2024");
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
