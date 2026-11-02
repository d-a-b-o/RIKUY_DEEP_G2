import { randomUUID } from "node:crypto";
import { hashPassword } from "better-auth/crypto";
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
