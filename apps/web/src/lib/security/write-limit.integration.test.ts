import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";

// Imports happen inside the test: a skipped DB suite must not initialize Prisma.
describe.skipIf(!process.env.DATABASE_URL)("HU48 PostgreSQL atomic quota", () => {
  it("enforces the quota for concurrent first inserts and expired windows without unique-key failures", async () => {
    const { getDb } = await import("@/lib/db");
    const { consumeWriteLimit } = await import("./write-limit");
    const keys = Array.from({ length: 8 }, () => "hu48-write:test:" + randomUUID());
    const policy = { bucket: "test", max: 5, windowMs: 60_000 };
    async function burst(key: string) {
      // Wait for every query before assertions/cleanup, even when a query fails.
      const results = await Promise.allSettled(Array.from({ length: 20 }, () => consumeWriteLimit(key, policy)));
      expect(results.filter((result) => result.status === "rejected")).toEqual([]);
      const decisions = results.map((result) => {
        if (result.status === "rejected") throw result.reason;
        return result.value;
      });
      expect(decisions.filter((decision) => decision.allowed)).toHaveLength(5);
      expect(decisions.every((decision) => decision.retryAfter > 0 && decision.retryAfter <= 60)).toBe(true);
      expect(await getDb().rateLimit.count({ where: { key } })).toBe(1);
      expect((await getDb().rateLimit.findUniqueOrThrow({ where: { key } })).count).toBe(6);
    }
    try {
      // Repeat against fresh rows to exercise PostgreSQL's concurrent insert path.
      for (const key of keys) {
        await burst(key);
        await getDb().rateLimit.update({ where: { key }, data: { lastRequest: BigInt(Date.now() - 61_000) } });
        await burst(key);
      }
    } finally {
      await getDb().rateLimit.deleteMany({ where: { key: { in: keys } } });
      await getDb().$disconnect();
    }
  }, 15_000);
});
