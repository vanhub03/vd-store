import "reflect-metadata";
import { ValidationPipe } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { AppModule } from "./app.module";
import { DocumentBuilder, SwaggerModule } from "@nestjs/swagger";
import crypto from "node:crypto";
import { NextFunction, Request, Response } from "express";

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { rawBody: true });
  app.getHttpAdapter().getInstance().set("trust proxy", true);
  app.use((request: Request, response: Response, next: NextFunction) => {
    if (request.path.startsWith("/partner/v1")) {
      const requestId = String(request.headers["x-request-id"] ?? crypto.randomUUID()).slice(0, 100);
      request.headers["x-request-id"] = requestId;
      response.setHeader("X-Request-Id", requestId);
    }
    next();
  });
  app.enableCors({
    origin: true,
    credentials: true
  });
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true
    })
  );

  const partnerDocs = new DocumentBuilder()
    .setTitle("VD Store Partner API")
    .setDescription("Server-to-server API for VD Store collaborators. Never expose a live or test key in browser code.")
    .setVersion("1.0")
    .addBearerAuth()
    .build();
  const document = SwaggerModule.createDocument(app, partnerDocs, {
    include: [AppModule],
    operationIdFactory: (_controllerKey, methodKey) => methodKey
  });
  document.paths = Object.fromEntries(Object.entries(document.paths).filter(([path]) => path.startsWith("/partner/v1")));
  SwaggerModule.setup("partner/docs", app, document, { jsonDocumentUrl: "/partner/openapi.json" });

  const port = Number(process.env.PORT ?? 3000);
  await app.listen(port);
  console.log(`VD Store API listening on http://localhost:${port}`);
}

bootstrap();
