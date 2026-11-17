import { expect, it } from "vitest";
import { getDb } from "@/lib/db";
import { loadMonitoring, storeTelemetry } from "./service";

it.skipIf(!process.env.DATABASE_URL)("HU43 persists idempotently and computes real PostgreSQL average/p95", async () => {
  const db = getDb();
  const ids = [crypto.randomUUID(), crypto.randomUUID(), crypto.randomUUID()];
  const events = ids.map((id, i) => ({ id, type: "INFERENCE", version: "987.654.321", durationMs: (i + 1) * 100, backend: "CPU" }));
  const actor = { id: "test", role: "INSPECTOR" as const, empresaId: crypto.randomUUID() };
  try {
    expect((await storeTelemetry(db, actor, { events })).count).toBe(3);
    expect((await storeTelemetry(db, actor, { events })).count).toBe(0);
    const data = await loadMonitoring(db, { id: "platform-test", role: "SUPERADMIN", empresaId: null });
    const row = data.metrics.find(row => row.version === "987.654.321");
    expect(row).toMatchObject({ count: 3, averageMs: 200, p95Ms: 290, backend: "CPU" });
  } finally {
    await db.modelTelemetry.deleteMany({ where: { id: { in: ids } } });
  }
});
