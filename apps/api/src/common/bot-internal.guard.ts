import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from "@nestjs/common";

@Injectable()
export class BotInternalGuard implements CanActivate {
  canActivate(context: ExecutionContext) {
    const request = context.switchToHttp().getRequest<{ headers: Record<string, string | undefined> }>();
    const expected = process.env.BOT_INTERNAL_TOKEN;
    if (!expected || request.headers["x-bot-token"] !== expected) {
      throw new UnauthorizedException("Invalid bot internal token.");
    }
    return true;
  }
}
