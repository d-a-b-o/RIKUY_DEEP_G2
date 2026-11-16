import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";

// Imports happen inside the test: a skipped DB suite must not initialize Prisma.
describe.skipIf(!process.env.DATABASE_URL)("HU48 PostgreSQL atomic quota", () => {
  it("allows exactly the configured quota under concurrent requests, then resets the window", async () => {
    const { getDb } = await import("@/lib/db");
    const { consumeWriteLimit } = await import("./write-limit");
    const key = "hu48-write:test:" + randomUUID();
    const policy = { bucket: "test", max: 5, windowMs: 60_000 };
    try {
      const results = await Promise.all(Array.from({ length: 20 }, () => consumeWriteLimit(key, policy)));
      expect(results.filter((result) => result.allowed)).toHaveLength(5);
      await getDb().rateLimit.update({ where: { key }, data: { lastRequest: BigInt(Date.now() - 61_000) } });
      expect((await consumeWriteLimit(key, policy)).allowed).toBe(true);
    } finally {
      await getDb().rateLimit.deleteMany({ where: { key } });
      await getDb().$disconnect();
    }
  });
});
