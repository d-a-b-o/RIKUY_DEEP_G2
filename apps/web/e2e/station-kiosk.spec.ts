import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { hashPassword } from "better-auth/crypto";
import { Client } from "pg";
import { expect, test } from "./fixtures";
import { createAccount, deleteAccount, hasDatabase, TEST_PASSWORD, type TestAccount } from "./support/accounts";
import { serveModelFixture } from "./support/model";

/**
 * HU44 · Ciclo real de la estación automática con el modelo y una cámara
 * simulada: la cinta vacía calibra, cada pieza se inspecciona una vez y la cola
 * la registra en la base con origen LINE.
 */

const modelDir = process.env.E2E_MODEL_DIR;
const manifestUrl = process.env.NEXT_PUBLIC_MODEL_MANIFEST_URL;

async function sql<T>(run: (client: Client) => Promise<T>): Promise<T> {
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  try {
    return await run(client);
  } finally {
    await client.end();
  }
}

test.describe("Estación automática con cámara (HU44)", { tag: "@ui" }, () => {
  test.skip(!hasDatabase() || !modelDir || !manifestUrl, "Necesita PostgreSQL y una copia de prueba del modelo real.");

  let admin: TestAccount;
  let station: { email: string; id: string; batchId: string };

  test.beforeEach(async () => {
    admin = await createAccount("ADMIN");
    const manifest = JSON.parse(fs.readFileSync(path.join(modelDir!, new URL(manifestUrl!).pathname), "utf8"));
    const version: string = manifest.activeVersion;
    station = await sql(async (client) => {
      const {
        rows: [{ company_id: companyId }],
      } = await client.query<{ company_id: string }>(`SELECT company_id FROM "user" WHERE email = $1`, [admin.email]);
      const [partId, moldId, batchId, userId, stationId] = Array.from({ length: 5 }, () => randomUUID());
      const email = `estacion-${userId.slice(0, 8)}@rikuydeep.test`;
      await client.query(`INSERT INTO part (id, company_id, code, name, updated_at) VALUES ($1, $2, 'IMP-44', 'Impulsor', now())`, [partId, companyId]);
      await client.query(`INSERT INTO mold (id, company_id, part_id, code, updated_at) VALUES ($1, $2, $3, 'M-44', now())`, [moldId, companyId, partId]);
      await client.query(`INSERT INTO batch (id, company_id, mold_id, code) VALUES ($1, $2, $3, 'L-KIOSCO')`, [batchId, companyId, moldId]);
      await client.query(
        `INSERT INTO shift (id, company_id, name, start_time, end_time, updated_at) VALUES ($1, $2, 'Todo el día', '00:00', '23:59', now())`,
        [randomUUID(), companyId],
      );
      await client.query(
        `INSERT INTO model_version (id, version, artifact_path, input_size, decision_threshold)
         VALUES ($1, $2, 'e2e/model.json', 400, 0.2437) ON CONFLICT (version) DO NOTHING`,
        [randomUUID(), version],
      );
      await client.query(
        `INSERT INTO "user" (id, company_id, name, email, email_verified, role, updated_at) VALUES ($1, $2, 'Estación E2E', $3, true, 'STATION', now())`,
        [userId, companyId, email],
      );
      await client.query(
        `INSERT INTO account (id, user_id, account_id, provider_id, password, updated_at) VALUES ($1, $2, $2, 'credential', $3, now())`,
        [randomUUID(), userId, await hashPassword(TEST_PASSWORD)],
      );
      await client.query(
        `INSERT INTO station (id, company_id, user_id, name, line, current_batch_id, updated_at) VALUES ($1, $2, $3, 'Estación kiosco', 'Línea A', $4, now())`,
        [stationId, companyId, userId, batchId],
      );
      return { email, id: stationId, batchId };
    });
  });

  test.afterEach(async () => {
    await sql(async (client) => {
      const company = `(SELECT company_id FROM "user" WHERE email = $1)`;
      await client.query("BEGIN");
      await client.query(`ALTER TABLE inspection_event DISABLE TRIGGER inspection_event_append_only`);
      await client.query(`ALTER TABLE inspection DISABLE TRIGGER inspection_immutable`);
      await client.query(`DELETE FROM inspection_event WHERE company_id = ${company}`, [admin.email]);
      await client.query(`DELETE FROM inspection WHERE company_id = ${company}`, [admin.email]);
      await client.query(`ALTER TABLE inspection ENABLE TRIGGER inspection_immutable`);
      await client.query(`ALTER TABLE inspection_event ENABLE TRIGGER inspection_event_append_only`);
      await client.query("COMMIT");
      for (const table of ["station", "batch", "mold", "part", "shift"]) {
        await client.query(`DELETE FROM ${table} WHERE company_id = ${company}`, [admin.email]);
      }
      await client.query(`DELETE FROM "user" WHERE role = 'STATION' AND company_id = ${company}`, [admin.email]);
    });
    await deleteAccount(admin);
  });

  test("calibra con la cinta vacía, inspecciona cada pieza una vez y la registra", async ({ page, signInPage }) => {
    test.setTimeout(150_000);
    await serveModelFixture(page, modelDir!, manifestUrl!);
    const piece = fs.readFileSync(path.join(modelDir!, "referencia-ok.png")).toString("base64");

    // Cámara simulada: un canvas que dibuja la cinta vacía o la pieza según window.__escena.
    await page.addInitScript((pieceBase64: string) => {
      const canvas = document.createElement("canvas");
      canvas.width = 640;
      canvas.height = 480;
      const ctx = canvas.getContext("2d")!;
      const image = new Image();
      image.src = `data:image/png;base64,${pieceBase64}`;
      const w = window as unknown as { __escena: "vacia" | "pieza" };
      w.__escena = "vacia";
      const draw = () => {
        ctx.fillStyle = "#3a3f44";
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        if (w.__escena === "pieza" && image.complete) ctx.drawImage(image, 120, 40, 400, 400);
        requestAnimationFrame(draw);
      };
      draw();
      navigator.mediaDevices.getUserMedia = async () => canvas.captureStream(15);
    }, piece);

    await signInPage.goto("/panel/estacion");
    await signInPage.signIn(station.email, TEST_PASSWORD);
    await expect(page).toHaveURL(/\/panel\/estacion$/);
    const start = page.getByRole("button", { name: "Iniciar la estación" });
    await expect(start).toBeEnabled({ timeout: 90_000 });
    await start.click();

    const phase = page.getByTestId("estacion-fase");
    await expect(phase).toHaveText("Esperando pieza", { timeout: 10_000 });
    await expect(page.getByText(/Calibración: umbral de presencia/)).toBeVisible();

    for (let i = 1; i <= 2; i += 1) {
      await page.evaluate(() => ((window as unknown as { __escena: string }).__escena = "pieza"));
      await expect(page.getByTestId("estacion-veredicto")).toContainText(`Pieza ${i}`, { timeout: 15_000 });
      await expect(page.getByTestId("estacion-veredicto")).toHaveAttribute("data-verdict", "OK");
      // La pieza sigue en el encuadre: no se vuelve a inspeccionar.
      await page.waitForTimeout(1_500);
      await expect(page.getByTestId("estacion-contadores")).toContainText(`Inspeccionadas${i}`);
      await page.evaluate(() => ((window as unknown as { __escena: string }).__escena = "vacia"));
      await expect(phase).toHaveText("Esperando pieza");
    }

    // La cola envía el lote en segundo plano (cada 5 s).
    await expect
      .poll(
        () =>
          sql(async (client) =>
            (
              await client.query<{ n: string }>(
                `SELECT count(*) AS n FROM inspection WHERE station_id = $1 AND source = 'LINE' AND inspector_id IS NULL`,
                [station.id],
              )
            ).rows[0].n,
          ),
        { timeout: 20_000 },
      )
      .toBe("2");
    await expect(page.getByRole("status").filter({ hasText: "por enviar" })).toContainText("0 por enviar");
    const pieces = await sql(async (client) =>
      (await client.query<{ piece_number: number }>(`SELECT piece_number FROM inspection WHERE station_id = $1 ORDER BY piece_number`, [station.id])).rows,
    );
    expect(pieces.map((p) => p.piece_number)).toEqual([1, 2]);
  });
});
