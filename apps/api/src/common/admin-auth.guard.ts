import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from "@nestjs/common";
import { Request } from "express";
import jwt from "jsonwebtoken";
import { PrismaService } from "../prisma.service";

export type AdminRequest = Request & {
  admin?: {
    id: string;
    email: string;
    role: string;
  };
};

@Injectable()
export class AdminAuthGuard implements CanActivate {
  constructor(private readonly prisma: PrismaService) {}

  async canActivate(context: ExecutionContext) {
    const request = context.switchToHttp().getRequest<AdminRequest & { headers: Record<string, string | undefined> }>();
    const auth = request.headers.authorization;
    if (!auth?.startsWith("Bearer ")) {
      throw new UnauthorizedException("Missing admin token.");
    }

    try {
      const payload = jwt.verify(auth.slice(7), process.env.JWT_SECRET ?? "dev-secret") as {
        sub: string;
        email: string;
        role: string;
      };
      const admin = await this.prisma.admin.findUnique({ where: { id: payload.sub } });
      if (!admin) throw new UnauthorizedException("Admin no longer exists.");
      request.admin = { id: admin.id, email: admin.email, role: admin.role };
      return true;
    } catch {
      throw new UnauthorizedException("Invalid admin token.");
    }
  }
}
