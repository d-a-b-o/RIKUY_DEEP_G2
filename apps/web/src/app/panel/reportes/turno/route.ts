import { getActionUser } from "@/lib/auth/session";
import { ForbiddenError, forbiddenResponse } from "@/lib/authz";
import { getDb, isDatabaseConfigured } from "@/lib/db";
import { shiftReportXlsx } from "@/lib/reports/excel";
import { shiftReportPdf, type ImageLoader } from "@/lib/reports/pdf";
import { buildShiftReport, ReportError, reportFileName } from "@/lib/reports/shift-report";
import { createImageReadUrl, isStorageConfigured } from "@/lib/storage/r2";

/**
 * HU38 · Descarga del reporte de fin de turno (RIKDP-49).
 * GET /panel/reportes/turno?fecha=2026-11-08&turno=<id>&formato=pdf|xlsx
 *
 * El proxy ya exige `reportes:descargar` para /panel/reportes; aquí se vuelve a
 * comprobar porque una ruta de API no debe depender solo del proxy (HU32).
 */

const loadImage: ImageLoader = async (key) => {
  const response = await fetch(createImageReadUrl(key), { signal: AbortSignal.timeout(5000) });
  if (!response.ok) return null;
  return new Uint8Array(await response.arrayBuffer());
};

export async function GET(request: Request) {
  if (!isDatabaseConfigured()) return Response.json({ error: "unavailable" }, { status: 503 });
  const url = new URL(request.url);
  const format = url.searchParams.get("formato") === "xlsx" ? "xlsx" : "pdf";

  const user = await getActionUser();
  if (!user) return Response.json({ error: "unauthenticated" }, { status: 401 });

  const db = getDb();
  const account = await db.user.findUnique({ where: { id: user.id }, select: { name: true } });
  let report;
  try {
    report = await buildShiftReport(db, { ...user, name: account?.name }, {
      fecha: url.searchParams.get("fecha") ?? "",
      turno: url.searchParams.get("turno") ?? "",
    });
  } catch (error) {
    if (error instanceof ForbiddenError) return forbiddenResponse(error);
    if (error instanceof ReportError) {
      return Response.json({ error: error.code, message: error.message }, { status: error.code === "NOT_FOUND" ? 404 : 400 });
    }
    throw error;
  }

  const body =
    format === "xlsx" ? shiftReportXlsx(report) : await shiftReportPdf(report, isStorageConfigured() ? loadImage : undefined);
  const contentType =
    format === "xlsx" ? "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" : "application/pdf";

  return new Response(body as BodyInit, {
    headers: {
      "content-type": contentType,
      "content-disposition": `attachment; filename="${reportFileName(report, format)}"`,
      "cache-control": "private, no-store",
    },
  });
}
