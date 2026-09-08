import { BadRequestException } from "@nestjs/common";
import { describe, expect, it } from "vitest";
import { ShopService } from "./shop.service";

describe("ShopService financial guards", () => {
  const service = new ShopService({} as never, {} as never, {} as never);

  it.each([1, 999, 1.5, Number.NaN])("rejects an unsafe bank top-up amount: %s", async (amount) => {
    await expect(service.createTopup("telegram-user", amount)).rejects.toBeInstanceOf(BadRequestException);
  });

  it.each([1, 999, 1.5, Number.NaN])("rejects an unsafe USDT top-up quote amount: %s", async (amount) => {
    await expect(service.createCryptomusTopup("telegram-user", amount)).rejects.toBeInstanceOf(BadRequestException);
  });
});
