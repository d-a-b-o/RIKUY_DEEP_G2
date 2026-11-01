/**
 * Datos de demostración para desarrollo y previews.
 *
 * Es idempotente: se puede ejecutar varias veces sin duplicar datos.
 * No crea usuarios: las cuentas se crean con Better Auth (HU19) para que las
 * contraseñas queden con el hash correcto.
 *
 * Uso: npx prisma db seed
 */
import { config } from "dotenv";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../src/generated/prisma/client";

config({ path: [".env.local", ".env"], quiet: true });

if (process.env.VERCEL_ENV === "production" && process.env.ALLOW_PRODUCTION_SEED !== "true") {
  console.error("El seed de demostración no se ejecuta en producción.");
  process.exit(1);
}

const connectionString =
  process.env.DIRECT_URL ?? process.env.DATABASE_URL_UNPOOLED ?? process.env.DATABASE_URL;
if (!connectionString) {
  console.error("Configura DATABASE_URL (o DIRECT_URL) antes de ejecutar el seed.");
  process.exit(1);
}

const db = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });

/** Hora del día para columnas TIME (la fecha se ignora). */
const time = (hhmm: string) => new Date(`1970-01-01T${hhmm}:00.000Z`);

async function main() {
  const company = await db.company.upsert({
    where: { taxId: "20999999991" },
    update: {},
    create: {
      name: "Fundiciones Andinas (demo)",
      taxId: "20999999991",
      timezone: "America/Lima",
      batchRejectThreshold: "0.0500",
    },
  });

  const impeller = await db.part.upsert({
    where: { companyId_code: { companyId: company.id, code: "IMP-150" } },
    update: {},
    create: {
      companyId: company.id,
      code: "IMP-150",
      name: "Impulsor de bomba 150 mm",
      description: "Impulsor sumergible de aluminio fundido",
    },
  });

  const [moldM12] = await Promise.all(
    ["M-12", "M-13"].map((code) =>
      db.mold.upsert({
        where: { companyId_code: { companyId: company.id, code } },
        update: {},
        create: { companyId: company.id, partId: impeller.id, code, cavities: 1 },
      }),
    ),
  );

  const shifts = [
    { name: "Mañana", startTime: time("06:00"), endTime: time("14:00") },
    { name: "Tarde", startTime: time("14:00"), endTime: time("22:00") },
    { name: "Noche", startTime: time("22:00"), endTime: time("06:00") },
  ];
  for (const shift of shifts) {
    await db.shift.upsert({
      where: { companyId_name: { companyId: company.id, name: shift.name } },
      update: {},
      create: { companyId: company.id, ...shift },
    });
  }

  const batch = await db.batch.upsert({
    where: { companyId_code: { companyId: company.id, code: "L-0417" } },
    update: {},
    create: { companyId: company.id, moldId: moldM12.id, code: "L-0417", status: "OPEN" },
  });

  await db.station.upsert({
    where: { companyId_name: { companyId: company.id, name: "Línea 2 · Estación 1" } },
    update: {},
    create: {
      companyId: company.id,
      name: "Línea 2 · Estación 1",
      line: "Línea 2",
      currentBatchId: batch.id,
      config: {
        presenceThreshold: 0.12,
        motionThreshold: 0.02,
        stableFrames: 3,
        maxWaitMs: 2000,
        okPhotoEvery: 20,
        targetPiecesPerSecond: 1,
      },
    },
  });

  // Modelo de HU17 (MobileNetV2, 400×400) con sus métricas en el conjunto de prueba.
  await db.modelVersion.upsert({
    where: { version: "1.0.0" },
    update: {},
    create: {
      version: "1.0.0",
      artifactPath: "v1.0.0/model.json",
      inputSize: 400,
      decisionThreshold: "0.2649",
      recallDefective: "0.9829",
      accuracy: "0.9897",
    },
  });

  const counts = {
    empresas: await db.company.count(),
    piezas: await db.part.count(),
    moldes: await db.mold.count(),
    turnos: await db.shift.count(),
    lotes: await db.batch.count(),
    estaciones: await db.station.count(),
    modelos: await db.modelVersion.count(),
  };
  console.log("Seed completado:", counts);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
