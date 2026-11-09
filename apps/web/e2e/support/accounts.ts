import { randomUUID } from "node:crypto";
import { generateRandomString, hashPassword, symmetricEncrypt } from "better-auth/crypto";
import { Client } from "pg";

/**
 * Datos de prueba para Playwright: cada prueba crea su propia empresa y su
 * usuario directamente en Postgres (plan de pruebas, sección 4, «Datos»).
 */

export const TEST_PASSWORD = "Prueba-E2E-2026";

export type TestAccount = { email: string; name: string; password: string; companyName: string };

export function hasDatabase(): boolean {
  return Boolean(process.env.DATABASE_URL);
}

async function withClient<T>(run: (client: Client) => Promise<T>): Promise<T> {
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  try {
    return await run(client);
  } finally {
    await client.end();
  }
}

export async function createAccount(role: "ADMIN" | "INSPECTOR" | "VIEWER" = "INSPECTOR"): Promise<TestAccount> {
  const suffix = randomUUID().slice(0, 8);
  const account: TestAccount = {
    email: `e2e-${suffix}@rikuydeep.test`,
    name: `Usuario E2E ${suffix}`,
    password: TEST_PASSWORD,
    companyName: `Empresa E2E ${suffix}`,
  };
  const password = await hashPassword(account.password);

  await withClient(async (client) => {
    const companyId = randomUUID();
    const userId = randomUUID();
    await client.query("BEGIN");
    await client.query(
      `INSERT INTO company (id, name, tax_id, updated_at) VALUES ($1, $2, $3, now())`,
      [companyId, account.companyName, `E2E${suffix}`],
    );
    await client.query(
      `INSERT INTO "user" (id, company_id, name, email, email_verified, role, updated_at)
       VALUES ($1, $2, $3, $4, true, $5, now())`,
      [userId, companyId, account.name, account.email, role],
    );
    await client.query(
      `INSERT INTO account (id, user_id, account_id, provider_id, password, updated_at)
       VALUES ($1, $2, $2, 'credential', $3, now())`,
      [randomUUID(), userId, password],
    );
    await client.query("COMMIT");
  });
  return account;
}

export async function deleteAccount(account: TestAccount): Promise<void> {
  await withClient(async (client) => {
    await client.query(`DELETE FROM "user" WHERE email = $1`, [account.email]);
    await client.query(`DELETE FROM company WHERE name = $1`, [account.companyName]);
  });
}

/**
 * Activa la verificación en dos pasos de una cuenta directamente en la base,
 * igual que la deja Better Auth (HU29). Devuelve el secreto TOTP en claro para
 * que la prueba genere los códigos con totpCode().
 */
export async function enableTwoFactor(email: string): Promise<{ totpSecret: string; backupCodes: string[] }> {
  const key = process.env.BETTER_AUTH_SECRET;
  if (!key) throw new Error("Las pruebas de 2FA necesitan BETTER_AUTH_SECRET");
  const totpSecret = generateRandomString(32);
  const backupCodes = Array.from({ length: 10 }, () => generateRandomString(10, "a-z", "0-9", "A-Z")).map(
    (code) => `${code.slice(0, 5)}-${code.slice(5)}`,
  );
  const secret = await symmetricEncrypt({ key, data: totpSecret });
  const codes = await symmetricEncrypt({ key, data: JSON.stringify(backupCodes) });
  await withClient(async (client) => {
    const { rows } = await client.query<{ id: string }>(
      `UPDATE "user" SET two_factor_enabled = true WHERE email = $1 RETURNING id`,
      [email],
    );
    await client.query(
      `INSERT INTO two_factor (id, user_id, secret, backup_codes, verified) VALUES ($1, $2, $3, $4, true)`,
      [randomUUID(), rows[0].id, secret, codes],
    );
  });
  return { totpSecret, backupCodes };
}

/** Superadministrador de plataforma (sin empresa), con 2FA ya activada como exige HU29. */
export async function createSuperadmin(): Promise<TestAccount & { totpSecret: string }> {
  const suffix = randomUUID().slice(0, 8);
  const account: TestAccount = {
    email: `e2e-sa-${suffix}@rikuydeep.test`,
    name: `Superadmin E2E ${suffix}`,
    password: TEST_PASSWORD,
    companyName: "",
  };
  const password = await hashPassword(account.password);
  await withClient(async (client) => {
    const userId = randomUUID();
    await client.query("BEGIN");
    await client.query(
      `INSERT INTO "user" (id, company_id, name, email, email_verified, role, updated_at)
       VALUES ($1, NULL, $2, $3, true, 'SUPERADMIN', now())`,
      [userId, account.name, account.email],
    );
    await client.query(
      `INSERT INTO account (id, user_id, account_id, provider_id, password, updated_at)
       VALUES ($1, $2, $2, 'credential', $3, now())`,
      [randomUUID(), userId, password],
    );
    await client.query("COMMIT");
  });
  const { totpSecret } = await enableTwoFactor(account.email);
  return { ...account, totpSecret };
}

/** Borra una empresa creada desde la interfaz, con sus usuarios e invitaciones. */
export async function deleteCompanyByName(name: string): Promise<void> {
  await withClient(async (client) => {
    await client.query(`DELETE FROM "user" WHERE company_id IN (SELECT id FROM company WHERE name = $1)`, [name]);
    await client.query(`DELETE FROM company WHERE name = $1`, [name]);
  });
}
