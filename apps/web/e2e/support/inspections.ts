import { randomUUID } from "node:crypto";
import { Client } from "pg";

/**
 * Inspecciones de prueba para Playwright (HU40, HU42), insertadas directamente
 * en Postgres en la empresa de la cuenta indicada.
 */

export type SeededInspections = { ids: string[]; batchCode: string; modelVersion: string };

export async function seedInspections(email: string, count = 3): Promise<SeededInspections> {
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  try {
    const { rows } = await client.query<{ id: string; company_id: string }>(
      `SELECT id, company_id FROM "user" WHERE email = $1`,
      [email],
    );
    const user = rows[0];
    if (!user?.company_id) throw new Error(`La cuenta ${email} no tiene empresa`);
    const companyId = user.company_id;
    const suffix = randomUUID().slice(0, 8);
    const [partId, moldId, batchId, shiftId, modelId] = [randomUUID(), randomUUID(), randomUUID(), randomUUID(), randomUUID()];
    const modelVersion = `e2e-${suffix}`;
    const batchCode = `L-E2E-${suffix}`;

    await client.query("BEGIN");
    await client.query(`INSERT INTO part (id, company_id, code, name, updated_at) VALUES ($1, $2, 'IMP-E2E', 'Impulsor E2E', now())`, [
      partId,
      companyId,
    ]);
    await client.query(`INSERT INTO mold (id, company_id, part_id, code, updated_at) VALUES ($1, $2, $3, 'M-E2E', now())`, [
      moldId,
      companyId,
      partId,
    ]);
    await client.query(`INSERT INTO batch (id, company_id, mold_id, code) VALUES ($1, $2, $3, $4)`, [batchId, companyId, moldId, batchCode]);
    await client.query(
      `INSERT INTO shift (id, company_id, name, start_time, end_time, updated_at) VALUES ($1, $2, 'Turno E2E', '00:00', '23:59', now())`,
      [shiftId, companyId],
    );
    await client.query(
      `INSERT INTO model_version (id, version, artifact_path, input_size, decision_threshold) VALUES ($1, $2, 'e2e/model.json', 400, 0.2437)`,
      [modelId, modelVersion],
    );
    const ids: string[] = [];
    for (let i = 0; i < count; i++) {
      const id = randomUUID();
      const verdict = i === 0 ? "DEFECTIVE" : "OK";
      await client.query(
        `INSERT INTO inspection (id, company_id, batch_id, shift_id, mold_id, part_id, inspector_id, model_version_id, source,
           predicted_verdict, current_verdict, confidence, threshold_applied, image_key, captured_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'CAMERA', $9, $9, 0.9123, 0.2437, $10, now() - ($11 || ' minutes')::interval)`,
        [id, companyId, batchId, shiftId, moldId, partId, user.id, modelId, verdict, `${companyId}/e2e/${id}.jpg`, String(i * 5)],
      );
      await client.query(
        `INSERT INTO inspection_event (id, company_id, inspection_id, type, new_verdict, actor_id) VALUES ($1, $2, $3, 'CREATED', $4, $5)`,
        [randomUUID(), companyId, id, verdict, user.id],
      );
      ids.push(id);
    }
    await client.query("COMMIT");
    return { ids, batchCode, modelVersion };
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    await client.end();
  }
}
