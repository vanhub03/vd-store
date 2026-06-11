import { afterEach, describe, expect, it } from "vitest";
import { AnalyticsService, chunkReports } from "./analytics.service";

const originalPropertyId = process.env.GA_PROPERTY_ID;
const originalCredentials = process.env.GOOGLE_APPLICATION_CREDENTIALS;

afterEach(() => {
  if (originalPropertyId === undefined) delete process.env.GA_PROPERTY_ID;
  else process.env.GA_PROPERTY_ID = originalPropertyId;
  if (originalCredentials === undefined) delete process.env.GOOGLE_APPLICATION_CREDENTIALS;
  else process.env.GOOGLE_APPLICATION_CREDENTIALS = originalCredentials;
});

describe("AnalyticsService", () => {
  it("splits overview reports within the GA4 batch limit", () => {
    const requests = Array.from({ length: 8 }, (_, index) => index);

    expect(chunkReports(requests)).toEqual([
      [0, 1, 2, 3, 4],
      [5, 6, 7]
    ]);
    expect(chunkReports(requests).every((batch) => batch.length <= 5)).toBe(true);
  });

  it("degrades safely when Google Analytics is not configured", async () => {
    delete process.env.GA_PROPERTY_ID;
    delete process.env.GOOGLE_APPLICATION_CREDENTIALS;
    const service = new AnalyticsService();

    await expect(service.overview("7d")).resolves.toMatchObject({
      status: "not_configured",
      range: "7d",
      summary: { activeUsers: 0 }
    });
    await expect(service.realtime()).resolves.toMatchObject({
      status: "not_configured",
      activeUsers: 0
    });
  });

  it("uses 30 days for an unsupported range", async () => {
    delete process.env.GA_PROPERTY_ID;
    delete process.env.GOOGLE_APPLICATION_CREDENTIALS;
    const service = new AnalyticsService();

    await expect(service.overview("365d")).resolves.toMatchObject({
      status: "not_configured",
      range: "30d"
    });
  });
});
