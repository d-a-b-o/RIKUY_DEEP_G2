import { afterEach, describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "@/generated/prisma/client";
import { createTelemetryReporter } from "./client";
import { telemetryBatchSchema } from "./schema";
import { loadMonitoring, storeTelemetry } from "./service";
import { requiredPermission } from "@/lib/authz/routes";
vi.mock("@/lib/authz", async () => {
  const actual = await vi.importActual<typeof import("@/lib/authz")>("@/lib/authz");
  return { ...actual, authorize: vi.fn(async (user, permission) => {
    if (!actual.can(user, permission)) throw new Error("FORBIDDEN");
  }) };
});
const input = { type: "INFERENCE" as const, version: "1.0.0", durationMs: 123, backend: "CPU" as const };
const actor = { id: "u", role: "INSPECTOR" as const, empresaId: "company-a" };
afterEach(() => vi.useRealTimers());
describe("HU43", () => {
  it("bounds batches and rejects foreign tenant fields, arbitrary messages and invalid timing", () => {
    const event = { ...input, id: crypto.randomUUID() };
    expect(telemetryBatchSchema.safeParse({ events: [event] }).success).toBe(true);
    for (const change of [{ companyId: "other" }, { durationMs: -1 }, { durationMs: Infinity }, { message: "secret" }]) {
      expect(telemetryBatchSchema.safeParse({ events: [{ ...event, ...change }] }).success).toBe(false);
    }
    expect(telemetryBatchSchema.safeParse({ events: Array(51).fill(event) }).success).toBe(false);
  });
  it("retries with identical event IDs, backs off and bounds memory", async () => {
    vi.useFakeTimers();
    const send = vi.fn().mockResolvedValueOnce(false).mockResolvedValue(true);
    const reporter = createTelemetryReporter(send);
    reporter.record(input);
    await reporter.flush(); await reporter.flush();
    expect(send).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(60_001);
    await reporter.flush();
    expect(send.mock.calls[1][0]).toEqual(send.mock.calls[0][0]);
    for (let i = 0; i < 300; i++) reporter.record(input);
    expect([reporter.drain(), reporter.drain(), reporter.drain(), reporter.drain(), reporter.drain()].flat()).toHaveLength(200);
  });
  it("uses the server tenant and retains unregistered model version labels with idempotent inserts", async () => {
    const db = { modelVersion: { findMany: vi.fn().mockResolvedValue([]) }, modelTelemetry: { createMany: vi.fn().mockResolvedValue({ count: 1 }) } };
    const event = { ...input, id: crypto.randomUUID() };
    await storeTelemetry(db as unknown as PrismaClient, actor, { events: [event] });
    expect(db.modelTelemetry.createMany).toHaveBeenCalledWith({ skipDuplicates: true, data: [expect.objectContaining({
      id: event.id, companyId: "company-a", modelVersionLabel: "1.0.0", modelVersionId: null, backend: "CPU",
    })] });
    await expect(storeTelemetry(db as unknown as PrismaClient, { ...actor, role: "VIEWER" }, { events: [event] })).rejects.toThrow("FORBIDDEN");
  });
  it("protects both the status route and its data query", async () => {
    expect(requiredPermission("/panel/admin/monitoreo")).toBe("monitoreo:ver");
    const query = vi.fn().mockResolvedValue([]);
    const db = { $queryRaw: query } as unknown as PrismaClient;
    await expect(loadMonitoring(db, actor)).rejects.toThrow("FORBIDDEN");
    expect(query).not.toHaveBeenCalled();
    const now = new Date("2026-11-16T22:00:00Z");
    const result = await loadMonitoring(db, { ...actor, role: "SUPERADMIN", empresaId: null }, now);
    expect(result.since.toISOString()).toBe("2026-11-15T22:00:00.000Z");
    expect(query).toHaveBeenCalledOnce();
  });
});
