import "server-only";
import { getDb } from "@/lib/db";
import { parseModelManifest } from "@/lib/model/manifest";

export type Health = { ok: boolean; checkedAt: string; durationMs: number };
async function probe(work: () => Promise<unknown>): Promise<Health> {
  const begin = Date.now();
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([work(), new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error("timeout")), 6000);
    })]);
    return { ok: true, checkedAt: new Date().toISOString(), durationMs: Date.now() - begin };
  } catch {
    return { ok: false, checkedAt: new Date().toISOString(), durationMs: Date.now() - begin };
  } finally { clearTimeout(timer); }
}

export function databaseHealth(): Promise<Health> {
  return probe(() => getDb().$transaction(async tx => tx.$queryRaw`SELECT 1`, { timeout: 3000, maxWait: 1000 }));
}

export function modelHealth(): Promise<Health> {
  return probe(async () => {
    const url = new URL(process.env.NEXT_PUBLIC_MODEL_MANIFEST_URL ?? "");
    if (url.protocol !== "https:" || url.username || url.password) throw new Error("configuration");
    const response = await fetch(url, { cache: "no-store", redirect: "error", signal: AbortSignal.timeout(5000) });
    if (!response.ok || !response.body) throw new Error("unavailable");
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let bytes = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > 262144) { await reader.cancel(); throw new Error("too large"); }
      chunks.push(value);
    }
    parseModelManifest(JSON.parse(Buffer.concat(chunks).toString("utf8")));
  });
}
