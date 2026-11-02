import { toNextJsHandler } from "better-auth/next-js";
import { getAuth } from "@/lib/auth/server";

/** Endpoints de Better Auth en /api/auth/* (RIKDP-132). */
const handler = (request: Request) => getAuth().handler(request);

export const { GET, POST } = toNextJsHandler(handler);
