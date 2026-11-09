"use client";

import { twoFactorClient } from "better-auth/client/plugins";
import { createAuthClient } from "better-auth/react";

/**
 * Cliente de Better Auth para las pantallas. Llama a /api/auth del mismo dominio.
 * El segundo paso del login (HU29) lo muestra el propio formulario de /ingresar.
 */
export const authClient = createAuthClient({ plugins: [twoFactorClient()] });
