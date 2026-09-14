import { describe, expect, it } from "vitest";
import { isTelegramHandlerTimeout } from "./runtime";

describe("Telegram bot runtime recovery", () => {
  it("recognizes Telegraf handler timeout errors", () => {
    const timeout = new Error("Promise timed out after 30000 milliseconds");
    timeout.name = "TimeoutError";
    expect(isTelegramHandlerTimeout(timeout)).toBe(true);
  });

  it("does not restart the bot for ordinary command errors", () => {
    expect(isTelegramHandlerTimeout(new Error("Product not found"))).toBe(false);
  });
});
