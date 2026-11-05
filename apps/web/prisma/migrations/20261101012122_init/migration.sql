-- CreateEnum
CREATE TYPE "company_status" AS ENUM ('ACTIVE', 'INACTIVE');

-- CreateEnum
CREATE TYPE "role" AS ENUM ('SUPERADMIN', 'ADMIN', 'INSPECTOR', 'VIEWER', 'STATION');

-- CreateEnum
CREATE TYPE "batch_status" AS ENUM ('OPEN', 'CLOSED');

-- CreateEnum
CREATE TYPE "inspection_source" AS ENUM ('LINE', 'CAMERA', 'BATCH', 'UPLOAD');

-- CreateEnum
CREATE TYPE "verdict" AS ENUM ('OK', 'DEFECTIVE');

-- CreateEnum
CREATE TYPE "inference_backend" AS ENUM ('WEBGL', 'WASM');

-- CreateEnum
CREATE TYPE "inspection_event_type" AS ENUM ('CREATED', 'CORRECTED', 'FLAGGED_FOR_RETRAINING');

-- CreateEnum
CREATE TYPE "lead_status" AS ENUM ('NEW', 'CONTACTED', 'DISCARDED');

-- CreateEnum
CREATE TYPE "telemetry_type" AS ENUM ('INFERENCE', 'LOAD_ERROR');

-- CreateTable
CREATE TABLE "company" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "tax_id" TEXT,
    "status" "company_status" NOT NULL DEFAULT 'ACTIVE',
    "require_two_factor" BOOLEAN NOT NULL DEFAULT false,
    "timezone" TEXT NOT NULL DEFAULT 'America/Lima',
    "batch_reject_threshold" DECIMAL(5,4) NOT NULL DEFAULT 0.05,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "company_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user" (
    "id" TEXT NOT NULL,
    "company_id" TEXT,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "email_verified" BOOLEAN NOT NULL DEFAULT false,
    "image" TEXT,
    "role" "role" NOT NULL DEFAULT 'VIEWER',
    "active" BOOLEAN NOT NULL DEFAULT true,
    "two_factor_enabled" BOOLEAN NOT NULL DEFAULT false,
    "failed_login_count" INTEGER NOT NULL DEFAULT 0,
    "locked_until" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "user_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "session" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    "ip_address" TEXT,
    "user_agent" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "account" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "account_id" TEXT NOT NULL,
    "provider_id" TEXT NOT NULL,
    "access_token" TEXT,
    "refresh_token" TEXT,
    "id_token" TEXT,
    "access_token_expires_at" TIMESTAMPTZ(3),
    "refresh_token_expires_at" TIMESTAMPTZ(3),
    "scope" TEXT,
    "password" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "account_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "verification" (
    "id" TEXT NOT NULL,
    "identifier" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "verification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "two_factor" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "secret" TEXT NOT NULL,
    "backup_codes" TEXT NOT NULL,

    CONSTRAINT "two_factor_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "invitation" (
    "id" TEXT NOT NULL,
    "company_id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "role" "role" NOT NULL,
    "token_hash" TEXT NOT NULL,
    "invited_by_id" TEXT NOT NULL,
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    "accepted_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "invitation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "part" (
    "id" TEXT NOT NULL,
    "company_id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "part_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "mold" (
    "id" TEXT NOT NULL,
    "company_id" TEXT NOT NULL,
    "part_id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "cavities" INTEGER NOT NULL DEFAULT 1,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "mold_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "shift" (
    "id" TEXT NOT NULL,
    "company_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "start_time" TIME(0) NOT NULL,
    "end_time" TIME(0) NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "shift_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "batch" (
    "id" TEXT NOT NULL,
    "company_id" TEXT NOT NULL,
    "mold_id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "status" "batch_status" NOT NULL DEFAULT 'OPEN',
    "opened_by_id" TEXT,
    "opened_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "closed_at" TIMESTAMPTZ(3),

    CONSTRAINT "batch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "station" (
    "id" TEXT NOT NULL,
    "company_id" TEXT NOT NULL,
    "user_id" TEXT,
    "name" TEXT NOT NULL,
    "line" TEXT NOT NULL,
    "current_batch_id" TEXT,
    "config" JSONB NOT NULL DEFAULT '{}',
    "active" BOOLEAN NOT NULL DEFAULT true,
    "last_seen_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "station_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "model_version" (
    "id" TEXT NOT NULL,
    "version" TEXT NOT NULL,
    "artifact_path" TEXT NOT NULL,
    "input_size" INTEGER NOT NULL,
    "decision_threshold" DECIMAL(5,4) NOT NULL,
    "recall_defective" DECIMAL(5,4),
    "accuracy" DECIMAL(5,4),
    "mlflow_run_id" TEXT,
    "published_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "model_version_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "inspection" (
    "id" TEXT NOT NULL,
    "company_id" TEXT NOT NULL,
    "batch_id" TEXT NOT NULL,
    "shift_id" TEXT NOT NULL,
    "mold_id" TEXT NOT NULL,
    "part_id" TEXT NOT NULL,
    "inspector_id" TEXT,
    "station_id" TEXT,
    "piece_number" INTEGER,
    "model_version_id" TEXT NOT NULL,
    "source" "inspection_source" NOT NULL,
    "predicted_verdict" "verdict" NOT NULL,
    "confidence" DECIMAL(5,4) NOT NULL,
    "threshold_applied" DECIMAL(5,4) NOT NULL,
    "image_key" TEXT,
    "image_sha256" TEXT,
    "inference_ms" INTEGER,
    "backend" "inference_backend",
    "warnings" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "captured_at" TIMESTAMPTZ(3) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "current_verdict" "verdict" NOT NULL,
    "corrected_at" TIMESTAMPTZ(3),

    CONSTRAINT "inspection_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "inspection_event" (
    "id" TEXT NOT NULL,
    "company_id" TEXT NOT NULL,
    "inspection_id" TEXT NOT NULL,
    "type" "inspection_event_type" NOT NULL,
    "previous_verdict" "verdict",
    "new_verdict" "verdict",
    "reason" TEXT,
    "actor_id" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "inspection_event_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "lead" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "company_name" TEXT NOT NULL,
    "role" TEXT,
    "phone" TEXT,
    "message" TEXT,
    "status" "lead_status" NOT NULL DEFAULT 'NEW',
    "consented_at" TIMESTAMPTZ(3) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "lead_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "access_denied_log" (
    "id" TEXT NOT NULL,
    "user_id" TEXT,
    "company_id" TEXT,
    "method" TEXT NOT NULL,
    "path" TEXT NOT NULL,
    "action" TEXT,
    "ip_hash" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "access_denied_log_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "model_telemetry" (
    "id" TEXT NOT NULL,
    "company_id" TEXT,
    "model_version_id" TEXT,
    "type" "telemetry_type" NOT NULL,
    "duration_ms" INTEGER,
    "backend" "inference_backend",
    "message" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "model_telemetry_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "company_tax_id_key" ON "company"("tax_id");

-- CreateIndex
CREATE UNIQUE INDEX "user_email_key" ON "user"("email");

-- CreateIndex
CREATE INDEX "user_company_id_role_idx" ON "user"("company_id", "role");

-- CreateIndex
CREATE UNIQUE INDEX "session_token_key" ON "session"("token");

-- CreateIndex
CREATE INDEX "session_user_id_idx" ON "session"("user_id");

-- CreateIndex
CREATE INDEX "account_user_id_idx" ON "account"("user_id");

-- CreateIndex
CREATE INDEX "verification_identifier_idx" ON "verification"("identifier");

-- CreateIndex
CREATE UNIQUE INDEX "two_factor_user_id_key" ON "two_factor"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "invitation_token_hash_key" ON "invitation"("token_hash");

-- CreateIndex
CREATE INDEX "invitation_company_id_email_idx" ON "invitation"("company_id", "email");

-- CreateIndex
CREATE UNIQUE INDEX "part_company_id_code_key" ON "part"("company_id", "code");

-- CreateIndex
CREATE INDEX "mold_part_id_idx" ON "mold"("part_id");

-- CreateIndex
CREATE UNIQUE INDEX "mold_company_id_code_key" ON "mold"("company_id", "code");

-- CreateIndex
CREATE UNIQUE INDEX "shift_company_id_name_key" ON "shift"("company_id", "name");

-- CreateIndex
CREATE INDEX "batch_company_id_status_idx" ON "batch"("company_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "batch_company_id_code_key" ON "batch"("company_id", "code");

-- CreateIndex
CREATE UNIQUE INDEX "station_user_id_key" ON "station"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "station_company_id_name_key" ON "station"("company_id", "name");

-- CreateIndex
CREATE UNIQUE INDEX "model_version_version_key" ON "model_version"("version");

-- CreateIndex
CREATE INDEX "inspection_company_id_captured_at_idx" ON "inspection"("company_id", "captured_at" DESC);

-- CreateIndex
CREATE INDEX "inspection_company_id_batch_id_idx" ON "inspection"("company_id", "batch_id");

-- CreateIndex
CREATE INDEX "inspection_company_id_shift_id_captured_at_idx" ON "inspection"("company_id", "shift_id", "captured_at");

-- CreateIndex
CREATE INDEX "inspection_company_id_mold_id_current_verdict_idx" ON "inspection"("company_id", "mold_id", "current_verdict");

-- CreateIndex
CREATE INDEX "inspection_company_id_station_id_captured_at_idx" ON "inspection"("company_id", "station_id", "captured_at");

-- CreateIndex
CREATE INDEX "inspection_event_inspection_id_created_at_idx" ON "inspection_event"("inspection_id", "created_at");

-- CreateIndex
CREATE INDEX "inspection_event_company_id_type_created_at_idx" ON "inspection_event"("company_id", "type", "created_at");

-- CreateIndex
CREATE INDEX "lead_status_created_at_idx" ON "lead"("status", "created_at");

-- CreateIndex
CREATE INDEX "access_denied_log_company_id_created_at_idx" ON "access_denied_log"("company_id", "created_at");

-- CreateIndex
CREATE INDEX "model_telemetry_type_created_at_idx" ON "model_telemetry"("type", "created_at");

-- AddForeignKey
ALTER TABLE "user" ADD CONSTRAINT "user_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "session" ADD CONSTRAINT "session_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "account" ADD CONSTRAINT "account_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "two_factor" ADD CONSTRAINT "two_factor_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invitation" ADD CONSTRAINT "invitation_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invitation" ADD CONSTRAINT "invitation_invited_by_id_fkey" FOREIGN KEY ("invited_by_id") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "part" ADD CONSTRAINT "part_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mold" ADD CONSTRAINT "mold_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mold" ADD CONSTRAINT "mold_part_id_fkey" FOREIGN KEY ("part_id") REFERENCES "part"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shift" ADD CONSTRAINT "shift_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "batch" ADD CONSTRAINT "batch_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "batch" ADD CONSTRAINT "batch_mold_id_fkey" FOREIGN KEY ("mold_id") REFERENCES "mold"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "batch" ADD CONSTRAINT "batch_opened_by_id_fkey" FOREIGN KEY ("opened_by_id") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "station" ADD CONSTRAINT "station_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "station" ADD CONSTRAINT "station_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "station" ADD CONSTRAINT "station_current_batch_id_fkey" FOREIGN KEY ("current_batch_id") REFERENCES "batch"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inspection" ADD CONSTRAINT "inspection_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inspection" ADD CONSTRAINT "inspection_batch_id_fkey" FOREIGN KEY ("batch_id") REFERENCES "batch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inspection" ADD CONSTRAINT "inspection_shift_id_fkey" FOREIGN KEY ("shift_id") REFERENCES "shift"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inspection" ADD CONSTRAINT "inspection_mold_id_fkey" FOREIGN KEY ("mold_id") REFERENCES "mold"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inspection" ADD CONSTRAINT "inspection_part_id_fkey" FOREIGN KEY ("part_id") REFERENCES "part"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inspection" ADD CONSTRAINT "inspection_inspector_id_fkey" FOREIGN KEY ("inspector_id") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inspection" ADD CONSTRAINT "inspection_station_id_fkey" FOREIGN KEY ("station_id") REFERENCES "station"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inspection" ADD CONSTRAINT "inspection_model_version_id_fkey" FOREIGN KEY ("model_version_id") REFERENCES "model_version"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inspection_event" ADD CONSTRAINT "inspection_event_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inspection_event" ADD CONSTRAINT "inspection_event_inspection_id_fkey" FOREIGN KEY ("inspection_id") REFERENCES "inspection"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inspection_event" ADD CONSTRAINT "inspection_event_actor_id_fkey" FOREIGN KEY ("actor_id") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "access_denied_log" ADD CONSTRAINT "access_denied_log_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "model_telemetry" ADD CONSTRAINT "model_telemetry_model_version_id_fkey" FOREIGN KEY ("model_version_id") REFERENCES "model_version"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ─── Reglas que Prisma no expresa en el esquema ───────────────────────────
-- docs/arquitectura/modelo-datos.md («Reglas de negocio») y ADR 0004.

-- El superadministrador es el único usuario sin empresa.
ALTER TABLE "user"
  ADD CONSTRAINT "user_superadmin_without_company"
  CHECK (("role" = 'SUPERADMIN') = ("company_id" IS NULL));

-- Cada inspección la registra una persona o una estación, nunca ambas ni ninguna.
ALTER TABLE "inspection"
  ADD CONSTRAINT "inspection_inspector_or_station"
  CHECK (num_nonnulls("inspector_id", "station_id") = 1);

-- Toda pieza defectuosa conserva su foto.
ALTER TABLE "inspection"
  ADD CONSTRAINT "inspection_defective_has_image"
  CHECK ("predicted_verdict" <> 'DEFECTIVE' OR "image_key" IS NOT NULL);

-- Una corrección exige motivo y veredicto nuevo.
ALTER TABLE "inspection_event"
  ADD CONSTRAINT "inspection_event_correction_has_reason"
  CHECK ("type" <> 'CORRECTED' OR ("reason" IS NOT NULL AND length(btrim("reason")) > 0 AND "new_verdict" IS NOT NULL));

-- Inmutabilidad de la trazabilidad (ADR 0004):
-- inspection solo admite actualizar current_verdict y corrected_at; nunca DELETE.
CREATE FUNCTION "rikuy_protect_inspection"() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Las inspecciones no se pueden borrar (ADR 0004)' USING ERRCODE = 'restrict_violation';
  END IF;
  IF (to_jsonb(NEW) - 'current_verdict' - 'corrected_at') IS DISTINCT FROM (to_jsonb(OLD) - 'current_verdict' - 'corrected_at') THEN
    RAISE EXCEPTION 'Solo se pueden actualizar current_verdict y corrected_at de una inspección (ADR 0004)' USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "inspection_immutable"
  BEFORE UPDATE OR DELETE ON "inspection"
  FOR EACH ROW EXECUTE FUNCTION "rikuy_protect_inspection"();

-- inspection_event es solo de inserción.
CREATE FUNCTION "rikuy_protect_inspection_event"() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'Los eventos de inspección no se pueden modificar ni borrar (ADR 0004)' USING ERRCODE = 'restrict_violation';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "inspection_event_append_only"
  BEFORE UPDATE OR DELETE ON "inspection_event"
  FOR EACH ROW EXECUTE FUNCTION "rikuy_protect_inspection_event"();
