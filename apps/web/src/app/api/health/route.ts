import { databaseHealth } from "@/lib/monitoring/health";
export const dynamic = "force-dynamic";
export async function GET() {
  const health = await databaseHealth();
  return Response.json({ status: health.ok ? "ok" : "unavailable", checkedAt: health.checkedAt }, {
    status: health.ok ? 200 : 503, headers: { "cache-control": "no-store" },
  });
}
