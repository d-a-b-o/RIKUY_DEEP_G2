import { Client } from "pg";
import { expect, test } from "./fixtures";
import { createAccount, hasDatabase, type TestAccount } from "./support/accounts";
import { seedInspections, type SeededInspections } from "./support/inspections";

/**
 * PT5 · RIKDP-265 — IDOR de punta a punta: con la sesión de otra empresa se
 * piden por URL los recursos de la empresa A. Las pantallas responden 404 sin
 * mostrar datos, y las descargas se rechazan. La lista completa de servicios
 * está en src/lib/security/idor.test.ts.
 */
test.describe("Acceso a recursos de otra empresa (IDOR)", { tag: "@regression" }, () => {
  test.skip(!hasDatabase(), "Necesita DATABASE_URL");

  let owner: TestAccount;
  let intruder: TestAccount;
  let seeded: SeededInspections;
  let shiftId: string;
  let batchId: string;

  test.beforeEach(async () => {
    owner = await createAccount("ADMIN");
    intruder = await createAccount("ADMIN");
    seeded = await seedInspections(owner.email, 2);
    const client = new Client({ connectionString: process.env.DATABASE_URL });
    await client.connect();
    try {
      const { rows } = await client.query<{ shift_id: string; batch_id: string }>(
        `SELECT shift_id, batch_id FROM inspection WHERE id = $1`,
        [seeded.ids[0]],
      );
      shiftId = rows[0].shift_id;
      batchId = rows[0].batch_id;
    } finally {
      await client.end();
    }
  });

  test("las pantallas y descargas de otra empresa no se abren desde la URL", async ({ page, signInPage }) => {
    await signInPage.goto("/panel");
    await signInPage.signIn(intruder.email, intruder.password);
    await expect(page).toHaveURL(/\/panel$/);

    // Detalle de una inspección de A: página «no encontrada», sin el código de lote de A.
    // Con streaming (cacheComponents), notFound() ocurre después de enviar la
    // cabecera, así que el código HTTP puede ser 200; lo que importa es el contenido.
    await page.goto(`/panel/inspecciones/${seeded.ids[0]}`);
    await expect(page.getByRole("heading", { name: "404" })).toBeVisible();
    await expect(page.getByText(seeded.batchCode)).toHaveCount(0);

    // Historial filtrado por el lote de A: ningún resultado.
    await page.goto(`/panel/inspecciones?lote=${batchId}&turno=${shiftId}`);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    await expect(page.getByText(seeded.batchCode)).toHaveCount(0);
    for (const id of seeded.ids) await expect(page.locator(`a[href$="${id}"]`)).toHaveCount(0);

    // Reporte de fin de turno de un turno de A: rechazado, sin archivo.
    const today = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Lima" }).format(new Date());
    for (const formato of ["pdf", "xlsx"]) {
      const response = await page.request.get(`/panel/reportes/turno?fecha=${today}&turno=${shiftId}&formato=${formato}`);
      expect(response.status()).toBe(404);
      expect(response.headers()["content-disposition"]).toBeUndefined();
    }
  });

  test("el dueño sí ve su inspección (control de la prueba)", async ({ page, signInPage }) => {
    await signInPage.goto("/panel");
    await signInPage.signIn(owner.email, owner.password);
    await expect(page).toHaveURL(/\/panel$/);
    const detail = await page.goto(`/panel/inspecciones/${seeded.ids[0]}`);
    expect(detail?.status()).toBe(200);
    await expect(page.getByText(seeded.batchCode).first()).toBeVisible();
  });
});
