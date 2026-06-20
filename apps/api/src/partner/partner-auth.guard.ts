import { CanActivate, ExecutionContext, HttpException, Injectable, OnModuleDestroy, OnModuleInit, SetMetadata } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { CustomerRole, PartnerEnvironment } from "@prisma/client";
import { Request, Response } from "express";
import crypto from "node:crypto";
import IORedis from "ioredis";
import { PrismaService } from "../prisma.service";

export const PARTNER_SCOPE = "partner-scope";
export const PartnerScope = (scope: PartnerScopeName) => SetMetadata(PARTNER_SCOPE, scope);
export type PartnerScopeName = "catalog:read" | "balance:read" | "orders:read" | "orders:write";

export type PartnerRequest = Request & {
  partner?: {
    credentialId: string;
    environment: PartnerEnvironment;
    scopes: string[];
    user: {
      id: string;
      email: string | null;
      partnerReadRateLimit: number;
      partnerWriteRateLimit: number;
    };
  };
};

export class PartnerApiException extends HttpException {
  constructor(status: number, code: string, detail: string, extensions: Record<string, unknown> = {}) {
    super({ code, detail, ...extensions }, status);
  }
}

@Injectable()
export class PartnerAuthGuard implements CanActivate {
  constructor(
    private readonly prisma: PrismaService,
    private readonly reflector: Reflector
  ) {}

  async canActivate(context: ExecutionContext) {
    if (process.env.PARTNER_API_ENABLED === "false") {
      throw new PartnerApiException(503, "partner_api_disabled", "Partner API is temporarily disabled.");
    }
    const request = context.switchToHttp().getRequest<PartnerRequest>();
    if (request.headers.origin) {
      throw new PartnerApiException(403, "browser_requests_forbidden", "Partner API keys may only be used by server-side applications.");
    }
    const authorization = firstHeader(request.headers.authorization);
    if (!authorization?.startsWith("Bearer ")) {
      throw new PartnerApiException(401, "missing_api_key", "Provide the API key as a Bearer token.");
    }
    const rawKey = authorization.slice(7).trim();
    if (!/^vd_(live|test)_[A-Za-z0-9_-]{32,}$/.test(rawKey)) {
      throw new PartnerApiException(401, "invalid_api_key", "The API key is invalid.");
    }
    const credential = await this.prisma.partnerApiCredential.findUnique({
      where: { keyHash: hashApiKey(rawKey) },
      include: { user: true }
    });
    if (!credential || credential.revokedAt || (credential.expiresAt && credential.expiresAt <= new Date())) {
      throw new PartnerApiException(401, "invalid_api_key", "The API key is invalid, expired, or revoked.");
    }
    if (credential.user.role !== CustomerRole.COLLABORATOR || credential.user.isBlocked || !credential.user.partnerApiEnabled) {
      throw new PartnerApiException(403, "partner_account_disabled", "The collaborator API account is disabled.");
    }
    const requiredScope = this.reflector.getAllAndOverride<PartnerScopeName>(PARTNER_SCOPE, [context.getHandler(), context.getClass()]);
    if (requiredScope && !credential.scopes.includes(requiredScope)) {
      throw new PartnerApiException(403, "insufficient_scope", `This key requires the ${requiredScope} scope.`, { requiredScope });
    }
    request.partner = {
      credentialId: credential.id,
      environment: credential.environment,
      scopes: credential.scopes,
      user: {
        id: credential.user.id,
        email: credential.user.email,
        partnerReadRateLimit: credential.user.partnerReadRateLimit,
        partnerWriteRateLimit: credential.user.partnerWriteRateLimit
      }
    };
    await this.prisma.partnerApiCredential.update({ where: { id: credential.id }, data: { lastUsedAt: new Date() } });
    return true;
  }
}

@Injectable()
export class PartnerRateLimitGuard implements CanActivate, OnModuleInit, OnModuleDestroy {
  private redis?: IORedis;
  private readonly memory = new Map<string, { count: number; expiresAt: number }>();
  private readonly concurrent = new Map<string, number>();

  onModuleInit() {
    if (process.env.REDIS_URL) {
      this.redis = new IORedis(process.env.REDIS_URL, { maxRetriesPerRequest: 1, lazyConnect: true });
      this.redis.on("error", () => undefined);
    }
  }

  async onModuleDestroy() {
    await this.redis?.quit().catch(() => undefined);
  }

  async canActivate(context: ExecutionContext) {
    const request = context.switchToHttp().getRequest<PartnerRequest>();
    const response = context.switchToHttp().getResponse<Response>();
    const partner = request.partner;
    if (!partner) return true;
    const write = request.method === "POST";
    const limit = write ? partner.user.partnerWriteRateLimit : partner.user.partnerReadRateLimit;
    const bucket = Math.floor(Date.now() / 60_000);
    const key = `partner-rate:${partner.credentialId}:${write ? "write" : "read"}:${bucket}`;
    const count = await this.increment(key);
    response.setHeader("RateLimit-Limit", String(limit));
    response.setHeader("RateLimit-Remaining", String(Math.max(0, limit - count)));
    response.setHeader("RateLimit-Reset", String((bucket + 1) * 60));
    if (count > limit) {
      response.setHeader("Retry-After", String((bucket + 1) * 60 - Math.floor(Date.now() / 1000)));
      throw new PartnerApiException(429, "rate_limit_exceeded", "Too many requests. Retry after the current rate-limit window.");
    }

    if (write && request.path.endsWith("/orders")) {
      const concurrencyKey = `partner-concurrency:${partner.credentialId}`;
      const active = await this.acquireConcurrency(concurrencyKey);
      if (active > 3) throw new PartnerApiException(429, "concurrency_limit_exceeded", "At most three order requests may run concurrently.");
      let released = false;
      const release = () => {
        if (released) return;
        released = true;
        void this.releaseConcurrency(concurrencyKey);
      };
      response.once("finish", release);
      response.once("close", release);
    }
    return true;
  }

  private async increment(key: string) {
    if (!this.redis && process.env.NODE_ENV === "production") {
      throw new PartnerApiException(503, "rate_limiter_unavailable", "The order service is temporarily unavailable.");
    }
    if (this.redis) {
      try {
        if (this.redis.status === "wait") await this.redis.connect();
        const count = await this.redis.incr(key);
        if (count === 1) await this.redis.expire(key, 70);
        return count;
      } catch {
        if (process.env.NODE_ENV === "production") {
          throw new PartnerApiException(503, "rate_limiter_unavailable", "The order service is temporarily unavailable.");
        }
      }
    }
    const now = Date.now();
    const entry = this.memory.get(key);
    const next = !entry || entry.expiresAt <= now ? { count: 1, expiresAt: now + 70_000 } : { ...entry, count: entry.count + 1 };
    this.memory.set(key, next);
    return next.count;
  }

  private async acquireConcurrency(key: string) {
    if (this.redis) {
      try {
        if (this.redis.status === "wait") await this.redis.connect();
        const active = await this.redis.incr(key);
        await this.redis.expire(key, 60);
        if (active > 3) await this.redis.decr(key);
        return active;
      } catch {
        if (process.env.NODE_ENV === "production") throw new PartnerApiException(503, "rate_limiter_unavailable", "The order service is temporarily unavailable.");
      }
    }
    const active = (this.concurrent.get(key) ?? 0) + 1;
    if (active <= 3) this.concurrent.set(key, active);
    return active;
  }

  private async releaseConcurrency(key: string) {
    if (this.redis) {
      await this.redis.decr(key).catch(() => undefined);
      return;
    }
    const next = Math.max(0, (this.concurrent.get(key) ?? 1) - 1);
    if (next === 0) this.concurrent.delete(key);
    else this.concurrent.set(key, next);
  }
}

export function hashApiKey(rawKey: string) {
  return crypto.createHash("sha256").update(rawKey).digest("hex");
}

function firstHeader(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}
