import { config } from "dotenv";
import { defineConfig } from "prisma/config";

// Las variables locales viven en .env.local (o .env). En Vercel y en CI llegan
// como variables de entorno del proceso.
config({ path: [".env.local", ".env"], quiet: true });

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
    seed: "tsx prisma/seed.ts",
  },
  // Las migraciones usan la conexión directa (sin pooler); la app, DATABASE_URL.
  // Puede faltar al ejecutar `prisma generate`, que no se conecta a la base de datos.
  datasource: {
    // DATABASE_URL_UNPOOLED es el nombre que usa la integración de Neon con Vercel.
    url: process.env.DIRECT_URL ?? process.env.DATABASE_URL_UNPOOLED ?? process.env.DATABASE_URL,
  },
});
