import { Injectable, UnauthorizedException } from "@nestjs/common";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { PrismaService } from "../prisma.service";

@Injectable()
export class AuthService {
  constructor(private readonly prisma: PrismaService) {}

  async login(email: string, password: string) {
    const admin = await this.prisma.admin.findUnique({ where: { email: email.toLowerCase().trim() } });
    if (!admin) {
      throw new UnauthorizedException("Email hoặc mật khẩu không đúng.");
    }

    const ok = await bcrypt.compare(password, admin.passwordHash);
    if (!ok) {
      throw new UnauthorizedException("Email hoặc mật khẩu không đúng.");
    }

    const token = jwt.sign(
      {
        sub: admin.id,
        email: admin.email,
        role: admin.role
      },
      process.env.JWT_SECRET ?? "dev-secret",
      { expiresIn: "7d" }
    );

    return {
      token,
      admin: {
        id: admin.id,
        email: admin.email,
        name: admin.name,
        role: admin.role
      }
    };
  }
}
