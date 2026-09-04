import { BroadcastDeliveryStatus } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";
import { BroadcastService } from "./broadcast.service";

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

describe("BroadcastService", () => {
  it("stores a validated image and rejects an overlong caption before sending", async () => {
    const prisma = {
      broadcast: { create: vi.fn().mockResolvedValue({ id: "broadcast_1" }) }
    };
    const service = new BroadcastService(prisma as never, {} as never);

    await service.createBroadcast("admin_1", "Thông báo", "Nội dung", {
      buffer: PNG_SIGNATURE,
      mimetype: "image/png",
      originalname: "announcement.png",
      size: PNG_SIGNATURE.length
    });

    expect(prisma.broadcast.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        imageData: PNG_SIGNATURE,
        imageMimeType: "image/png",
        imageFileName: "broadcast.png"
      })
    }));

    await expect(
      service.createBroadcast("admin_1", "Thông báo", "x".repeat(1025), {
        buffer: PNG_SIGNATURE,
        mimetype: "image/png",
        originalname: "announcement.png",
        size: PNG_SIGNATURE.length
      })
    ).rejects.toThrow("tối đa 1024 ký tự");
  });

  it("sends an image broadcast as exactly one photo with its caption", async () => {
    const delivery = {
      id: "delivery_1",
      broadcastId: "broadcast_1",
      status: BroadcastDeliveryStatus.PENDING,
      broadcast: {
        id: "broadcast_1",
        message: "<b>Caption</b>",
        imageData: PNG_SIGNATURE,
        imageMimeType: "image/png",
        imageFileName: "broadcast.png"
      },
      user: { telegramId: "123456789" }
    };
    const prisma = {
      broadcastDelivery: {
        findUnique: vi.fn().mockResolvedValue(delivery),
        update: vi.fn().mockResolvedValue({}),
        count: vi.fn().mockResolvedValue(0)
      },
      broadcast: { update: vi.fn().mockResolvedValue({}) }
    };
    const telegram = {
      sendMessage: vi.fn(),
      sendPhotoWithCaption: vi.fn().mockResolvedValue(true)
    };
    const service = new BroadcastService(prisma as never, telegram as never);

    await (service as unknown as { processDelivery: (job: unknown) => Promise<void> }).processDelivery({
      data: { deliveryId: delivery.id }
    });

    expect(telegram.sendPhotoWithCaption).toHaveBeenCalledTimes(1);
    expect(telegram.sendPhotoWithCaption).toHaveBeenCalledWith(
      "123456789",
      { data: PNG_SIGNATURE, fileName: "broadcast.png" },
      "<b>Caption</b>"
    );
    expect(telegram.sendMessage).not.toHaveBeenCalled();
  });
});
