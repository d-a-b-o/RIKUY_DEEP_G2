/**
 * Quita la verificación en dos pasos de una cuenta que perdió su móvil y sus
 * códigos de respaldo (HU29). Es la vía de recuperación de último recurso:
 * la persona deberá volver a activarla al entrar si su cuenta la tiene obligatoria.
 *
 * Uso: npm run reset:two-factor
 *
 * Se conecta a DIRECT_URL (o DATABASE_URL) y pide confirmar la base de datos
 * y el correo antes de cambiar nada. También cierra las sesiones de la cuenta.
 */
import { config } from "dotenv";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../src/generated/prisma/client";
import { createPrompter } from "./prompt";

config({ path: [".env.local", ".env"], quiet: true });

function databaseLabel(connectionString: string): string {
  try {
    const url = new URL(connectionString);
    return `${url.hostname}${url.pathname}`;
  } catch {
    return "(URL no válida)";
  }
}

async function main() {
  const connectionString = process.env.DIRECT_URL ?? process.env.DATABASE_URL_UNPOOLED ?? process.env.DATABASE_URL;
  if (!connectionString) {
    console.error("Configura DIRECT_URL o DATABASE_URL (en .env.local o en el entorno) antes de ejecutar este script.");
    process.exit(1);
  }

  const rl = createPrompter();
  try {
    console.log(`\nBase de datos: ${databaseLabel(connectionString)}`);
    const email = (await rl.ask("Correo de la cuenta: ")).trim().toLowerCase();
    if (!email) throw new Error("Escribe un correo.");

    const db = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });
    try {
      const user = await db.user.findUnique({
        where: { email },
        select: { id: true, name: true, role: true, twoFactorEnabled: true },
      });
      if (!user) throw new Error("No existe ninguna cuenta con ese correo.");
      if (!user.twoFactorEnabled) {
        console.log("Esa cuenta no tiene la verificación en dos pasos activada. No se cambió nada.");
        return;
      }

      const confirm = await rl.ask(
        `Se quitará la 2FA de ${user.name} (${user.role}) y se cerrarán sus sesiones. Escribe "SI" para continuar: `,
      );
      if (confirm.trim() !== "SI") {
        console.log("Cancelado. No se cambió nada.");
        return;
      }

      await db.$transaction([
        db.twoFactor.deleteMany({ where: { userId: user.id } }),
        db.user.update({ where: { id: user.id }, data: { twoFactorEnabled: false } }),
        db.session.deleteMany({ where: { userId: user.id } }),
        // Equipos de confianza: dejan de saltarse el código.
        db.verification.deleteMany({ where: { value: user.id, identifier: { startsWith: "trust-device-" } } }),
      ]);
      console.log(`\nListo: ${email} ya no tiene 2FA. Al entrar podrá (o deberá) activarla de nuevo.`);
    } finally {
      await db.$disconnect();
    }
  } finally {
    rl.close();
  }
}

main().catch((error: unknown) => {
  console.error(`\nNo se cambió nada: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
