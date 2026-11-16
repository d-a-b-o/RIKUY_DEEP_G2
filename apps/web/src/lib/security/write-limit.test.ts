import { describe, expect, it, vi } from "vitest";
vi.mock("@/lib/db", () => ({ getDb: () => ({ $queryRaw: query }) }));
const query = vi.fn();
import { consumeWriteLimit, writeLimitKey, writePolicy } from "./write-limit";

describe("HU48 write limiter", () => {
  it("groups writes, avoiding unbounded keys from resource paths", () => {
    expect(writePolicy("/panel/admin/empresas/a")).toEqual(writePolicy("/panel/inspeccion"));
    expect(writePolicy("/invitacion").max).toBe(10);
    expect(writePolicy("/").max).toBe(5);
  });
  it("hashes IPs and shares a conservative bucket when no trusted address is available", () => {
    const policy = writePolicy("/");
    const key = writeLimitKey(new Headers({ "x-forwarded-for": "127.0.0.1" }), policy);
    expect(key).toMatch(/^hu48-write:[a-f0-9]{64}$/);
    expect(key).not.toContain("127.0.0.1");
    expect(writeLimitKey(new Headers(), policy)).toBe(writeLimitKey(new Headers({ "x-forwarded-for": "invalid" }), policy));
  });
  it("calculates Retry-After after the query when a later request creates the window first", async () => {
    // This request starts at 1000ms, but another creates the row at 1050ms
    // while ours waits. Our query finishes at 1100ms: 59.95s remain, not 60.05s.
    const clock = vi.spyOn(Date, "now").mockReturnValueOnce(1000).mockReturnValue(1100);
    query.mockResolvedValueOnce([{ count: 6, last_request: BigInt(1050) }]);
    try {
      const result = await consumeWriteLimit("concurrent-window", { bucket: "test", max: 5, windowMs: 60_000 });
      expect(result).toEqual({ allowed: false, retryAfter: 60 });
    } finally {
      clock.mockRestore();
    }
  });
  it("rejects over-quota requests with a bounded Retry-After and propagates storage errors", async () => {
    const policy = writePolicy("/");
    query.mockResolvedValueOnce([{ count: 6, last_request: BigInt(Date.now()) }]);
    const result = await consumeWriteLimit("test", policy);
    expect(result.allowed).toBe(false);
    expect(result.retryAfter).toBeGreaterThan(0);
    expect(result.retryAfter).toBeLessThanOrEqual(600);
    query.mockRejectedValueOnce(new Error("database down"));
    await expect(consumeWriteLimit("test", policy)).rejects.toThrow("database down");
  });
});
