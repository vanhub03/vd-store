import { Body, Controller, Get, Post, Req, UseGuards } from "@nestjs/common";
import { IsEmail, IsString, MinLength } from "class-validator";
import { AdminAuthGuard, AdminRequest } from "../common/admin-auth.guard";
import { AuthService } from "./auth.service";

class LoginDto {
  @IsEmail()
  email!: string;

  @IsString()
  @MinLength(6)
  password!: string;
}

@Controller("auth")
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Post("login")
  login(@Body() body: LoginDto) {
    return this.auth.login(body.email, body.password);
  }

  @Get("me")
  @UseGuards(AdminAuthGuard)
  me(@Req() request: AdminRequest) {
    return { admin: request.admin };
  }
}
