/**
 * Pruebas de integración de las reglas que la migración inicial impone en la
 * base de datos (restricciones y triggers de inmutabilidad, ADR 0004).
 *
 * Necesitan una base PostgreSQL con las migraciones aplicadas (DATABASE_URL).
 * En CI la proporciona el servicio postgres del workflow. Todo ocurre dentro de
 * una transacción que se revierte al final, así que no deja datos.
 */
import { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const databaseUrl = process.env.DATABASE_URL;

describe.skipIf(!databaseUrl)("reglas de integridad de la base de datos", () => {
  const client = new Client({ connectionString: databaseUrl });
  const ids: Record<string, string> = {};

  /** Ejecuta una sentencia que debe fallar, sin abortar la transacción de la prueba. */
  async function expectFailure(sql: string, params: unknown[] = []): Promise<string> {
    await client.query("SAVEPOINT expected_failure");
    try {
      await client.query(sql, params);
    } catch (error) {
      await client.query("ROLLBACK TO SAVEPOINT expected_failure");
      return (error as Error).message;
    }
    await client.query("ROLLBACK TO SAVEPOINT expected_failure");
    throw new Error(`Se esperaba un error y la sentencia se ejecutó: ${sql}`);
  }

  async function insertReturningId(sql: string, params: unknown[]): Promise<string> {
    const result = await client.query<{ id: string }>(`${sql} RETURNING id`, params);
    return result.rows[0].id;
  }

  const inspectionColumns = `(id, company_id, batch_id, shift_id, mold_id, part_id, inspector_id, station_id,
     model_version_id, source, predicted_verdict, confidence, threshold_applied, image_key, captured_at, current_verdict)`;

  function insertInspection(overrides: { inspectorId?: string | null; stationId?: string | null; verdict?: string; imageKey?: string | null }) {
    const { inspectorId = null, stationId = ids.station, verdict = "OK", imageKey = null } = overrides;
    return client.query<{ id: string }>(
      `INSERT INTO inspection ${inspectionColumns}
       VALUES (gen_random_uuid()::text, $1, $2, $3, $4, $5, $6, $7, $8, 'LINE', $9::verdict, 0.9, 0.2649, $10, now(), $9::verdict)
       RETURNING id`,
      [ids.company, ids.batch, ids.shift, ids.mold, ids.part, inspectorId, stationId, ids.model, verdict, imageKey],
    );
  }

  beforeAll(async () => {
    await client.connect();
    await client.query("BEGIN");
    ids.company = await insertReturningId(
      `INSERT INTO company (id, name, updated_at) VALUES (gen_random_uuid()::text, 'Prueba de integridad', now())`,
      [],
    );
    ids.part = await insertReturningId(
      `INSERT INTO part (id, company_id, code, name, updated_at) VALUES (gen_random_uuid()::text, $1, 'P-1', 'Pieza', now())`,
      [ids.company],
    );
    ids.mold = await insertReturningId(
      `INSERT INTO mold (id, company_id, part_id, code, updated_at) VALUES (gen_random_uuid()::text, $1, $2, 'M-1', now())`,
      [ids.company, ids.part],
    );
    ids.shift = await insertReturningId(
      `INSERT INTO shift (id, company_id, name, start_time, end_time, updated_at)
       VALUES (gen_random_uuid()::text, $1, 'Noche', '22:00', '06:00', now())`,
      [ids.company],
    );
    ids.batch = await insertReturningId(
      `INSERT INTO batch (id, company_id, mold_id, code) VALUES (gen_random_uuid()::text, $1, $2, 'L-1')`,
      [ids.company, ids.mold],
    );
    ids.station = await insertReturningId(
      `INSERT INTO station (id, company_id, name, line, updated_at) VALUES (gen_random_uuid()::text, $1, 'E-1', 'L1', now())`,
      [ids.company],
    );
    ids.model = await insertReturningId(
      `INSERT INTO model_version (id, version, artifact_path, input_size, decision_threshold)
       VALUES (gen_random_uuid()::text, '0.0.0-test-' || gen_random_uuid(), 'v0/model.json', 400, 0.2649)`,
      [],
    );
    ids.inspector = await insertReturningId(
      `INSERT INTO "user" (id, company_id, name, email, role, updated_at)
       VALUES (gen_random_uuid()::text, $1, 'Inspector', gen_random_uuid() || '@prueba.test', 'INSPECTOR', now())`,
      [ids.company],
    );
  });

  afterAll(async () => {
    await client.query("ROLLBACK");
    await client.end();
  });

  it("acepta una inspección OK de estación sin foto", async () => {
    const result = await insertInspection({});
    expect(result.rows[0].id).toBeTruthy();
  });

  it("exige inspector o estación, pero no ambos ni ninguno", async () => {
    expect(await expectFailure(
      `INSERT INTO inspection ${inspectionColumns} VALUES (gen_random_uuid()::text, $1, $2, $3, $4, $5, NULL, NULL, $6, 'LINE', 'OK', 0.9, 0.26, NULL, now(), 'OK')`,
      [ids.company, ids.batch, ids.shift, ids.mold, ids.part, ids.model],
    )).toContain("inspection_inspector_or_station");
    expect(await expectFailure(
      `INSERT INTO inspection ${inspectionColumns} VALUES (gen_random_uuid()::text, $1, $2, $3, $4, $5, $6, $7, $8, 'LINE', 'OK', 0.9, 0.26, NULL, now(), 'OK')`,
      [ids.company, ids.batch, ids.shift, ids.mold, ids.part, ids.inspector, ids.station, ids.model],
    )).toContain("inspection_inspector_or_station");
  });

  it("exige foto en toda pieza defectuosa", async () => {
    await client.query("SAVEPOINT s");
    const message = await insertInspection({ verdict: "DEFECTIVE", imageKey: null }).then(
      () => "sin error",
      (error: Error) => error.message,
    );
    await client.query("ROLLBACK TO SAVEPOINT s");
    expect(message).toContain("inspection_defective_has_image");
    const ok = await insertInspection({ verdict: "DEFECTIVE", imageKey: "companies/x/inspections/2026/11/a.jpg" });
    expect(ok.rows[0].id).toBeTruthy();
  });

  it("solo permite actualizar el veredicto vigente de una inspección", async () => {
    const { rows } = await insertInspection({});
    const id = rows[0].id;
    await client.query(`UPDATE inspection SET current_verdict = 'DEFECTIVE', corrected_at = now() WHERE id = $1`, [id]);
    expect(await expectFailure(`UPDATE inspection SET confidence = 0.1 WHERE id = $1`, [id])).toContain("ADR 0004");
    expect(await expectFailure(`UPDATE inspection SET predicted_verdict = 'DEFECTIVE' WHERE id = $1`, [id])).toContain("ADR 0004");
  });

  it("no permite borrar inspecciones", async () => {
    const { rows } = await insertInspection({});
    expect(await expectFailure(`DELETE FROM inspection WHERE id = $1`, [rows[0].id])).toContain("no se pueden borrar");
  });

  it("los eventos son solo de inserción y la corrección exige motivo", async () => {
    const { rows } = await insertInspection({});
    const inspectionId = rows[0].id;
    expect(await expectFailure(
      `INSERT INTO inspection_event (id, company_id, inspection_id, type, new_verdict, reason) VALUES (gen_random_uuid()::text, $1, $2, 'CORRECTED', 'DEFECTIVE', '  ')`,
      [ids.company, inspectionId],
    )).toContain("inspection_event_correction_has_reason");
    const eventId = await insertReturningId(
      `INSERT INTO inspection_event (id, company_id, inspection_id, type, previous_verdict, new_verdict, reason, actor_id)
       VALUES (gen_random_uuid()::text, $1, $2, 'CORRECTED', 'OK', 'DEFECTIVE', 'Poro visible en el borde', $3)`,
      [ids.company, inspectionId, ids.inspector],
    );
    expect(await expectFailure(`UPDATE inspection_event SET reason = 'otro' WHERE id = $1`, [eventId])).toContain("ADR 0004");
    expect(await expectFailure(`DELETE FROM inspection_event WHERE id = $1`, [eventId])).toContain("ADR 0004");
  });

  it("el superadministrador es el único usuario sin empresa", async () => {
    expect(await expectFailure(
      `INSERT INTO "user" (id, company_id, name, email, role, updated_at) VALUES (gen_random_uuid()::text, NULL, 'X', gen_random_uuid() || '@prueba.test', 'ADMIN', now())`,
    )).toContain("user_superadmin_without_company");
    expect(await expectFailure(
      `INSERT INTO "user" (id, company_id, name, email, role, updated_at) VALUES (gen_random_uuid()::text, $1, 'X', gen_random_uuid() || '@prueba.test', 'SUPERADMIN', now())`,
      [ids.company],
    )).toContain("user_superadmin_without_company");
  });

  it("las claves de negocio son únicas por empresa", async () => {
    expect(await expectFailure(
      `INSERT INTO mold (id, company_id, part_id, code, updated_at) VALUES (gen_random_uuid()::text, $1, $2, 'M-1', now())`,
      [ids.company, ids.part],
    )).toContain("duplicate key");
  });
});
