import { ArgumentsHost, Catch, ExceptionFilter, HttpException } from "@nestjs/common";
import { Request, Response } from "express";
import crypto from "node:crypto";

@Catch()
export class PartnerProblemFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost) {
    const response = host.switchToHttp().getResponse<Response>();
    const request = host.switchToHttp().getRequest<Request>();
    const status = exception instanceof HttpException ? exception.getStatus() : 500;
    const raw = exception instanceof HttpException ? exception.getResponse() : null;
    const body = typeof raw === "object" && raw ? raw as Record<string, unknown> : {};
    const rawMessage = body.detail ?? body.message ?? (exception instanceof Error ? exception.message : "Unexpected server error.");
    const detail = Array.isArray(rawMessage) ? rawMessage.join(", ") : String(rawMessage);
    const requestId = String(request.headers["x-request-id"] ?? crypto.randomUUID()).slice(0, 100);
    const code = typeof body.code === "string" ? body.code : inferCode(status, detail);
    response.setHeader("X-Request-Id", requestId);
    response.status(status).type("application/problem+json").send({
      type: `${process.env.API_BASE_URL ?? "https://api.vanhdao.io.vn"}/problems/${code}`,
      title: titleFor(status),
      status,
      detail: status === 500 ? "Unexpected server error." : detail,
      instance: request.originalUrl,
      code,
      requestId,
      ...safeExtensions(body)
    });
  }
}

function inferCode(status: number, detail: string) {
  const normalized = detail.toLowerCase();
  if (normalized.includes("so du") || normalized.includes("số dư")) return "insufficient_balance";
  if (normalized.includes("het hang") || normalized.includes("hết hàng")) return "out_of_stock";
  if (status === 400) return "invalid_request";
  if (status === 404) return "not_found";
  if (status === 409) return "conflict";
  return status === 500 ? "internal_error" : `http_${status}`;
}

function titleFor(status: number) {
  return ({ 400: "Bad Request", 401: "Unauthorized", 403: "Forbidden", 404: "Not Found", 409: "Conflict", 422: "Unprocessable Content", 429: "Too Many Requests", 500: "Internal Server Error", 503: "Service Unavailable" } as Record<number, string>)[status] ?? "Request Failed";
}

function safeExtensions(body: Record<string, unknown>) {
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(body)) {
    if (!["statusCode", "message", "error", "detail", "code"].includes(key)) result[key] = value;
  }
  return result;
}
