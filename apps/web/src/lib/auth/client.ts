"use client";

import { createAuthClient } from "better-auth/react";

/** Cliente de Better Auth para las pantallas. Llama a /api/auth del mismo dominio. */
export const authClient = createAuthClient();
