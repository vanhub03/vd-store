ALTER TABLE "Broadcast"
  ADD COLUMN "imageData" BYTEA,
  ADD COLUMN "imageMimeType" TEXT,
  ADD COLUMN "imageFileName" TEXT;

ALTER TABLE "Broadcast"
  ADD CONSTRAINT "Broadcast_image_metadata_check"
  CHECK (
    ("imageData" IS NULL AND "imageMimeType" IS NULL AND "imageFileName" IS NULL)
    OR
    ("imageData" IS NOT NULL AND "imageMimeType" IS NOT NULL AND "imageFileName" IS NOT NULL)
  );
