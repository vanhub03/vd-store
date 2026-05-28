import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from "@nestjs/common";
import { Request } from "express";
import jwt from "jsonwebtoken";
import { PrismaService } from "../prisma.service";

export type CustomerRequest = Request & {
  customer?: {
    id: string;
    email: string;
    displayName?: string | null;
    telegramId: string;
  };
};

@Injectable()
export class CustomerAuthGuard implements CanActivate {
  constructor(private readonly prisma: PrismaService) {}

  async canActivate(context: ExecutionContext) {
    const request = context.switchToHttp().getRequest<CustomerRequest & { headers: Record<string, string | undefined> }>();
    const auth = request.headers.authorization;
    if (!auth?.startsWith("Bearer ")) {
      throw new UnauthorizedException("Missing customer token.");
    }

    try {
      const payload = jwt.verify(auth.slice(7), process.env.JWT_SECRET ?? "dev-secret") as {
        sub: string;
        email?: string;
        kind?: string;
      };
      if (payload.kind !== "customer") throw new UnauthorizedException("Invalid customer token.");

      const customer = await this.prisma.telegramUser.findUnique({ where: { id: payload.sub } });
      if (!customer?.email || !customer.passwordHash) throw new UnauthorizedException("Customer no longer exists.");
      request.customer = {
        id: customer.id,
        email: customer.email,
        displayName: customer.displayName,
        telegramId: customer.telegramId
      };
      return true;
    } catch {
      throw new UnauthorizedException("Invalid customer token.");
    }
  }
}
