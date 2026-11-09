/**
 * Crea una cuenta de superadministrador (HU23).
 *
 * Uso: npm run create:superadmin
 *
 * Pide el nombre, el correo y la contraseña por consola, sin mostrarla ni
 * dejarla en el historial de la terminal. Se conecta a DIRECT_URL (o
 * DATABASE_URL) de .env.local, .env o del entorno, y pide confirmar la base de
 * datos antes de escribir. La contraseña se guarda con el mismo hash que usa
 * Better Auth, así que la cuenta entra por /ingresar como cualquier otra.
 */
import { randomUUID } from "node:crypto";
import { stdin, stdout } from "node:process";
import { createInterface, type Interface } from "node:readline";
import { hashPassword } from "better-auth/crypto";
import { config } from "dotenv";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../src/generated/prisma/client";
import { MAX_PASSWORD_LENGTH, MIN_PASSWORD_LENGTH } from "../src/lib/auth/config";

config({ path: [".env.local", ".env"], quiet: true });

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Lee todas las líneas de stdin de antemano cuando no es una terminal (por ejemplo, en pruebas). */
function createPrompter() {
  const rl: Interface & { _writeToOutput?: (text: string) => void } = createInterface({
    input: stdin,
    output: stdout,
    terminal: stdin.isTTY,
  });
  const queued: string[] = [];
  const waiting: ((line: string) => void)[] = [];
  let muted = false;
  const write = rl._writeToOutput?.bind(rl);
  rl._writeToOutput = (text: string) => {
    if (!muted || text.includes("\n")) write?.(muted ? "\n" : text);
  };
  rl.on("line", (line) => {
    const next = waiting.shift();
    if (next) next(line);
    else queued.push(line);
  });

  function ask(question: string, hidden = false): Promise<string> {
    stdout.write(question);
    muted = hidden && Boolean(stdin.isTTY);
    return new Promise((resolve) => {
      const take = (line: string) => {
        muted = false;
        if (hidden && !stdin.isTTY) stdout.write("\n");
        // La contraseña se guarda tal cual: el login no recorta espacios.
        resolve(hidden ? line : line.trim());
      };
      const ready = queued.shift();
      if (ready !== undefined) take(ready);
      else waiting.push(take);
    });
  }
  return { ask, close: () => rl.close() };
}

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

  const prompt = createPrompter();
  try {
    console.log(`\nBase de datos: ${databaseLabel(connectionString)}`);
    const confirm = await prompt.ask('Escribe "SI" para crear el superadministrador en esta base: ');
    if (confirm !== "SI") {
      console.log("Cancelado. No se cambió nada.");
      return;
    }

    const name = await prompt.ask("Nombre: ");
    if (name.length < 2) throw new Error("Escribe un nombre de al menos 2 caracteres.");

    const email = (await prompt.ask("Correo: ")).toLowerCase();
    if (!EMAIL.test(email)) throw new Error("El correo no es válido.");

    const password = await prompt.ask(`Contraseña (${MIN_PASSWORD_LENGTH} a ${MAX_PASSWORD_LENGTH} caracteres, no se muestra): `, true);
    if (password.length < MIN_PASSWORD_LENGTH || password.length > MAX_PASSWORD_LENGTH) {
      throw new Error(`La contraseña debe tener entre ${MIN_PASSWORD_LENGTH} y ${MAX_PASSWORD_LENGTH} caracteres.`);
    }
    const repeat = await prompt.ask("Repite la contraseña: ", true);
    if (repeat !== password) throw new Error("Las contraseñas no coinciden.");

    const db = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });
    try {
      const existing = await db.user.findUnique({ where: { email }, select: { role: true } });
      if (existing) {
        throw new Error(
          existing.role === "SUPERADMIN"
            ? "Ya existe un superadministrador con ese correo. Si olvidaste la contraseña, usa «¿Olvidaste tu contraseña?» en /ingresar."
            : `Ya existe una cuenta ${existing.role} con ese correo. Usa otro correo.`,
        );
      }

      const id = randomUUID();
      await db.user.create({
        data: {
          id,
          email,
          name,
          role: "SUPERADMIN",
          companyId: null,
          emailVerified: true,
          accounts: {
            create: { id: randomUUID(), accountId: id, providerId: "credential", password: await hashPassword(password) },
          },
        },
      });
      console.log(`\nListo: ${email} ya puede ingresar como superadministrador en /ingresar.`);
    } finally {
      await db.$disconnect();
    }
  } finally {
    prompt.close();
  }
}

main().catch((error: unknown) => {
  console.error(`\nNo se creó la cuenta: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
