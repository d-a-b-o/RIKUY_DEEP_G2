import { fileURLToPath } from "node:url";
import { config } from "dotenv";
import { defineConfig } from "vitest/config";

// Las pruebas de integración usan DATABASE_URL de .env.local (en local) o del entorno (CI).
config({ path: [".env.local", ".env"], quiet: true });

export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
      "server-only": fileURLToPath(new URL("./src/test/server-only-stub.ts", import.meta.url)),
    },
  },
  test: {
    exclude: ["**/node_modules/**", "**/.next/**", "src/generated/**", "e2e/**"],
    // Las pruebas de integración comparten la base de datos.
    fileParallelism: false,
  },
});
