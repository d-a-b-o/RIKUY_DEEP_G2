/**
 * Datos de la demo piloto / UAT (HU49-T01, RIKDP-244).
 *
 * Uso (desde apps/web):
 *   DIRECT_URL="<cadena directa>" npm run demo:uat
 *   DIRECT_URL="<cadena directa>" npm run demo:uat -- --modelo 0.9.0 --umbral 0.2437 --fotos ./defectos
 *
 * Crea, si no existen, una planta completa para el guion de docs/pruebas/uat-guion.md:
 * empresa «Planta piloto RikuyDeep (UAT)», pieza, moldes, tres turnos, un lote
 * cerrado y uno abierto, una estación con su cuenta técnica asignada al lote
 * abierto, la versión del modelo y cuatro cuentas (Admin, Inspector, Visualizador
 * y Estación) con la contraseña que se escribe al ejecutar.
 *
 * La primera vez agrega además el histórico de los últimos días (por defecto 7)
 * para que el dashboard, el historial y el reporte de turno tengan datos, con dos
 * veredictos corregidos. Las inspecciones son inmutables (ADR 0004): si la planta
 * ya tiene inspecciones, el histórico no se vuelve a generar.
 *
 * Fotos: las inspecciones defectuosas necesitan foto (regla 9). Con --fotos y las
 * variables R2_* configuradas, sube esas JPG a R2 y las usa; sin ellas, las claves
 * quedan sin objeto y el detalle de esas inspecciones históricas no muestra imagen.
 */
import { randomUUID } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { hashPassword } from "better-auth/crypto";
import { config } from "dotenv";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient, type Prisma, type Role } from "../src/generated/prisma/client";
import { MAX_PASSWORD_LENGTH, MIN_PASSWORD_LENGTH } from "../src/lib/auth/config";
import { presignUrl } from "../src/lib/storage/sigv4";
import { createPrompter } from "./prompt";

config({ path: [".env.local", ".env"], quiet: true });

const TAX_ID = "20999999992";
const COMPANY = "Planta piloto RikuyDeep (UAT)";
const DOMAIN = "uat.rikuydeep.test";
const TIME_ZONE = "America/Lima";

type Args = { modelo: string; umbral: string; dias: number; fotos?: string };

function parseArgs(argv: string[]): Args {
  const args: Args = { modelo: "1.0.0", umbral: "0.2649", dias: 7 };
  for (let i = 0; i < argv.length; i += 1) {
    const [flag, value] = [argv[i], argv[i + 1]];
    if (!value) continue;
    if (flag === "--modelo") args.modelo = value;
    else if (flag === "--umbral") args.umbral = value;
    else if (flag === "--dias") args.dias = Math.max(1, Math.min(30, Number(value) || 7));
    else if (flag === "--fotos") args.fotos = value;
    else continue;
    i += 1;
  }
  if (!/^\d+\.\d+\.\d+$/.test(args.modelo)) throw new Error("--modelo debe ser X.Y.Z");
  if (!(Number(args.umbral) > 0 && Number(args.umbral) < 1)) throw new Error("--umbral debe estar entre 0 y 1");
  return args;
}

function databaseLabel(connectionString: string): string {
  try {
    const url = new URL(connectionString);
    return `${url.hostname}${url.pathname}`;
  } catch {
    return "(URL no válida)";
  }
}

/** Generador determinista: el mismo histórico en cada base nueva. */
function seeded(seed: number) {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 2 ** 32;
  };
}

const time = (hhmm: string) => new Date(`1970-01-01T${hhmm}:00.000Z`);

/** Instante UTC de una fecha y hora locales de Lima (UTC−5, sin horario de verano). */
const limaInstant = (day: Date, hour: number, minute: number) =>
  new Date(Date.UTC(day.getUTCFullYear(), day.getUTCMonth(), day.getUTCDate(), hour + 5, minute));

type Uploader = ((key: string) => Promise<void>) | null;

function photoUploader(folder: string | undefined): Uploader {
  if (!folder) return null;
  const names = ["R2_ENDPOINT_URL", "R2_IMAGES_BUCKET", "R2_ACCESS_KEY_ID", "R2_SECRET_ACCESS_KEY"];
  const missing = names.filter((name) => !process.env[name]);
  if (missing.length) throw new Error(`--fotos necesita ${missing.join(", ")}`);
  const files = readdirSync(folder).filter((name) => /\.jpe?g$/i.test(name));
  if (files.length === 0) throw new Error(`No hay archivos .jpg en ${folder}`);
  let next = 0;
  return async (key) => {
    const body = readFileSync(join(folder, files[next++ % files.length]));
    const url = presignUrl({
      method: "PUT",
      url: `${process.env.R2_ENDPOINT_URL!.replace(/\/+$/, "")}/${encodeURIComponent(process.env.R2_IMAGES_BUCKET!)}/${key}`,
      credentials: { accessKeyId: process.env.R2_ACCESS_KEY_ID!, secretAccessKey: process.env.R2_SECRET_ACCESS_KEY! },
      region: "auto",
      expiresIn: 300,
    });
    const response = await fetch(url, { method: "PUT", headers: { "content-type": "image/jpeg" }, body });
    if (!response.ok) throw new Error(`R2 respondió ${response.status} al subir ${key}`);
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const connectionString = process.env.DIRECT_URL ?? process.env.DATABASE_URL_UNPOOLED ?? process.env.DATABASE_URL;
  if (!connectionString) {
    console.error("Configura DIRECT_URL o DATABASE_URL (en .env.local o en el entorno) antes de ejecutar este script.");
    process.exit(1);
  }
  const upload = photoUploader(args.fotos);

  const prompt = createPrompter();
  let password: string;
  try {
    console.log(`\nBase de datos: ${databaseLabel(connectionString)}`);
    const confirm = await prompt.ask('Escribe "SI" para crear o completar la planta de la UAT en esta base: ');
    if (confirm.trim() !== "SI") {
      console.log("Cancelado. No se cambió nada.");
      return;
    }
    password = await prompt.ask(
      `Contraseña para las 4 cuentas de la UAT (${MIN_PASSWORD_LENGTH} a ${MAX_PASSWORD_LENGTH} caracteres, no se muestra): `,
      true,
    );
    if (password.length < MIN_PASSWORD_LENGTH || password.length > MAX_PASSWORD_LENGTH) {
      throw new Error(`La contraseña debe tener entre ${MIN_PASSWORD_LENGTH} y ${MAX_PASSWORD_LENGTH} caracteres.`);
    }
  } finally {
    prompt.close();
  }

  const db = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });
  try {
    const company = await db.company.upsert({
      where: { taxId: TAX_ID },
      update: {},
      create: { name: COMPANY, taxId: TAX_ID, timezone: TIME_ZONE, batchRejectThreshold: "0.0500" },
    });
    const part = await db.part.upsert({
      where: { companyId_code: { companyId: company.id, code: "IMP-150" } },
      update: {},
      create: { companyId: company.id, code: "IMP-150", name: "Impulsor de bomba 150 mm", description: "Aluminio fundido" },
    });
    const molds = await Promise.all(
      ["M-12", "M-13"].map((code) =>
        db.mold.upsert({
          where: { companyId_code: { companyId: company.id, code } },
          update: {},
          create: { companyId: company.id, partId: part.id, code, cavities: 1 },
        }),
      ),
    );
    const shifts = [];
    for (const [name, start, end] of [
      ["Mañana", "06:00", "14:00"],
      ["Tarde", "14:00", "22:00"],
      ["Noche", "22:00", "06:00"],
    ] as const) {
      shifts.push(
        await db.shift.upsert({
          where: { companyId_name: { companyId: company.id, name } },
          update: {},
          create: { companyId: company.id, name, startTime: time(start), endTime: time(end) },
        }),
      );
    }
    const closedBatch = await db.batch.upsert({
      where: { companyId_code: { companyId: company.id, code: "L-UAT-01" } },
      update: {},
      create: { companyId: company.id, moldId: molds[1].id, code: "L-UAT-01", status: "CLOSED", closedAt: new Date() },
    });
    const openBatch = await db.batch.upsert({
      where: { companyId_code: { companyId: company.id, code: "L-UAT-02" } },
      update: {},
      create: { companyId: company.id, moldId: molds[0].id, code: "L-UAT-02", status: "OPEN" },
    });
    const model = await db.modelVersion.upsert({
      where: { version: args.modelo },
      update: {},
      create: { version: args.modelo, artifactPath: `v${args.modelo}/model.json`, inputSize: 400, decisionThreshold: args.umbral },
    });

    const hash = await hashPassword(password);
    const accounts: { key: string; name: string; role: Role }[] = [
      { key: "admin", name: "Ana Admin (UAT)", role: "ADMIN" },
      { key: "inspector", name: "Iván Inspector (UAT)", role: "INSPECTOR" },
      { key: "consulta", name: "Carla Consulta (UAT)", role: "VIEWER" },
      { key: "estacion", name: "Estación Línea 1 (UAT)", role: "STATION" },
    ];
    const ids: Record<string, string> = {};
    for (const account of accounts) {
      const email = `${account.key}@${DOMAIN}`;
      const existing = await db.user.findUnique({ where: { email }, select: { id: true, companyId: true } });
      if (existing && existing.companyId !== company.id) throw new Error(`${email} ya existe en otra empresa.`);
      if (existing) {
        ids[account.key] = existing.id;
        await db.account.updateMany({ where: { userId: existing.id, providerId: "credential" }, data: { password: hash } });
        continue;
      }
      const id = randomUUID();
      await db.user.create({
        data: {
          id,
          email,
          name: account.name,
          role: account.role,
          companyId: company.id,
          emailVerified: true,
          accounts: { create: { id: randomUUID(), accountId: id, providerId: "credential", password: hash } },
        },
      });
      ids[account.key] = id;
    }

    const station = await db.station.upsert({
      where: { companyId_name: { companyId: company.id, name: "Línea 1 · Estación 1" } },
      update: { currentBatchId: openBatch.id, userId: ids.estacion, active: true },
      create: {
        companyId: company.id,
        name: "Línea 1 · Estación 1",
        line: "Línea 1",
        userId: ids.estacion,
        currentBatchId: openBatch.id,
      },
    });

    const existing = await db.inspection.count({ where: { companyId: company.id } });
    let created = 0;
    if (existing === 0) {
      const random = seeded(20261201);
      const today = new Date();
      const rows: (Prisma.InspectionCreateManyInput & { id: string; capturedAt: Date })[] = [];
      const defectKeys: string[] = [];
      for (let d = args.dias; d >= 1; d -= 1) {
        const day = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate() - d));
        const batch = d > Math.ceil(args.dias / 2) ? closedBatch : openBatch;
        const moldId = batch.id === closedBatch.id ? molds[1].id : molds[0].id;
        for (const [s, shift] of shifts.entries()) {
          const startHour = [6, 14, 22][s];
          const pieces = 25 + Math.floor(random() * 15);
          for (let p = 0; p < pieces; p += 1) {
            const minute = Math.floor((p / pieces) * 470) + 5;
            const capturedAt = limaInstant(day, startHour + Math.floor(minute / 60), minute % 60);
            const defective = random() < 0.045;
            const probability = defective ? 0.55 + random() * 0.44 : random() * 0.12;
            const id = randomUUID();
            const imageKey = defective
              ? `companies/${company.id}/inspections/${capturedAt.getUTCFullYear()}/${String(capturedAt.getUTCMonth() + 1).padStart(2, "0")}/${id}.jpg`
              : null;
            if (imageKey) defectKeys.push(imageKey);
            rows.push({
              id,
              companyId: company.id,
              batchId: batch.id,
              shiftId: shift.id,
              moldId,
              partId: part.id,
              stationId: station.id,
              pieceNumber: rows.length + 1,
              modelVersionId: model.id,
              source: "LINE",
              predictedVerdict: defective ? "DEFECTIVE" : "OK",
              currentVerdict: defective ? "DEFECTIVE" : "OK",
              confidence: (defective ? probability : 1 - probability).toFixed(4),
              thresholdApplied: args.umbral,
              imageKey,
              inferenceMs: 180 + Math.floor(random() * 120),
              backend: "WEBGL",
              warnings: [],
              capturedAt,
            });
          }
        }
      }
      if (upload) {
        console.log(`Subiendo ${defectKeys.length} fotos de piezas defectuosas a R2…`);
        for (const key of defectKeys) await upload(key);
      }
      await db.$transaction(async (tx) => {
        await tx.inspection.createMany({ data: rows });
        await tx.inspectionEvent.createMany({
          data: rows.map((row) => ({
            companyId: company.id,
            inspectionId: row.id,
            type: "CREATED" as const,
            newVerdict: row.predictedVerdict,
            actorId: ids.estacion,
            createdAt: row.capturedAt,
          })),
        });
        // Dos correcciones del inspector, para mostrar el historial de eventos (HU40).
        const corrected = rows.filter((row) => row.predictedVerdict === "DEFECTIVE").slice(0, 2);
        for (const row of corrected) {
          const at = new Date(row.capturedAt.getTime() + 15 * 60_000);
          await tx.inspection.update({ where: { id: row.id }, data: { currentVerdict: "OK", correctedAt: at } });
          const reason = "Revisión manual: rebaba superficial dentro de tolerancia";
          await tx.inspectionEvent.create({
            data: {
              companyId: company.id,
              inspectionId: row.id,
              type: "CORRECTED",
              previousVerdict: "DEFECTIVE",
              newVerdict: "OK",
              reason,
              actorId: ids.inspector,
              createdAt: at,
            },
          });
          await tx.inspectionEvent.create({
            data: { companyId: company.id, inspectionId: row.id, type: "FLAGGED_FOR_RETRAINING", reason, actorId: ids.inspector, createdAt: at },
          });
        }
      });
      created = rows.length;
    }

    console.log(`\nListo: ${COMPANY}`);
    console.log(`  Cuentas: ${accounts.map((a) => `${a.key}@${DOMAIN}`).join(", ")} (contraseña: la que escribiste).`);
    console.log(`  Estación «${station.name}» asignada al lote abierto L-UAT-02. Modelo registrado: ${model.version}.`);
    console.log(
      created
        ? `  Histórico: ${created} inspecciones de los últimos ${args.dias} días${upload ? " con fotos en R2" : " (defectuosas sin foto: usa --fotos)"}.`
        : `  Histórico: ya existía (${existing} inspecciones); no se generó de nuevo.`,
    );
  } finally {
    await db.$disconnect();
  }
}

main().catch((error: unknown) => {
  console.error(`\nNo se completó la planta de la UAT: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
