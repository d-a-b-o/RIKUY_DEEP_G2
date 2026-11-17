import { afterEach, expect, it, vi } from "vitest";
const transaction = vi.hoisted(() => vi.fn());
vi.mock("@/lib/db", () => ({ getDb: () => ({ $transaction: transaction }) }));
import { databaseHealth, modelHealth } from "./health";
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });
it("reports database outages without exposing errors or connection strings", async () => {
  transaction.mockRejectedValueOnce(new Error("postgres://secret"));
  const result = await databaseHealth();
  expect(result.ok).toBe(false);
  expect(JSON.stringify(result)).not.toContain("secret");
  transaction.mockResolvedValueOnce([{ value: 1 }]);
  expect((await databaseHealth()).ok).toBe(true);
});
it("rejects malformed, oversized and failing manifests", async () => {
  vi.stubEnv("NEXT_PUBLIC_MODEL_MANIFEST_URL", "https://models.example/manifest.json");
  const fetcher = vi.fn().mockResolvedValueOnce(Response.json({ invalid: true }))
    .mockResolvedValueOnce(new Response("x".repeat(262145)))
    .mockResolvedValueOnce(new Response("down", { status: 503 }));
  vi.stubGlobal("fetch", fetcher);
  expect((await modelHealth()).ok).toBe(false);
  expect((await modelHealth()).ok).toBe(false);
  expect((await modelHealth()).ok).toBe(false);
  expect(fetcher).toHaveBeenCalledWith(expect.any(URL), expect.objectContaining({ cache: "no-store", redirect: "error" }));
});
