ALTER TYPE "inference_backend" ADD VALUE IF NOT EXISTS 'CPU';
ALTER TABLE "model_telemetry" ADD COLUMN "model_version_label" TEXT;
UPDATE "model_telemetry" t SET "model_version_label" = v.version
FROM "model_version" v WHERE t.model_version_id = v.id;
CREATE INDEX "model_telemetry_created_at_idx" ON "model_telemetry"("created_at");
