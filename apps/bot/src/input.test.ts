import { describe, expect, it } from "vitest";
import { isBareNumber, parseQuantityInput, parseVndAmount } from "./input";

describe("Telegram numeric input", () => {
  it("accepts positive whole-number quantities", () => {
    expect(parseQuantityInput("1")).toBe(1);
    expect(parseQuantityInput(" 10 ")).toBe(10);
    expect(parseQuantityInput("0")).toBeNull();
    expect(parseQuantityInput("1.5")).toBeNull();
  });

  it("requires an explicit top-up amount of at least 1,000 VND", () => {
    expect(parseVndAmount("1")).toBeNull();
    expect(parseVndAmount("999")).toBeNull();
    expect(parseVndAmount("1k")).toBe(1_000);
    expect(parseVndAmount("250.000")).toBe(250_000);
  });

  it("recognizes a standalone number so it can be rejected outside a checkout step", () => {
    expect(isBareNumber("1")).toBe(true);
    expect(isBareNumber("250.000")).toBe(true);
    expect(isBareNumber("/nap 250000")).toBe(false);
  });
});
