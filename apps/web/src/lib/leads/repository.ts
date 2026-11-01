import "server-only";
import { getDb } from "@/lib/db";
import type { DemoRequest } from "./schema";

/** Guarda la solicitud de demo como lead (RIKDP-115). */
export async function saveLead(request: DemoRequest): Promise<{ id: string }> {
  return getDb().lead.create({
    data: {
      name: request.name,
      email: request.email,
      companyName: request.company,
      role: request.role ?? null,
      phone: request.phone ?? null,
      message: request.message ?? null,
      consentedAt: new Date(),
    },
    select: { id: true },
  });
}
