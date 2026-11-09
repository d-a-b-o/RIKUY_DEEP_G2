import { createServer } from "node:http";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { build } from "esbuild";

// Reutiliza componente y estilos de producción, sin añadir una ruta de prueba a Next.
// esbuild es una dependencia transitiva de Vite/Vitest ya fijada en package-lock.
const root = process.cwd();
const { outputFiles } = await build({
  stdin: {
    contents: `import React from 'react';
      import {createRoot} from 'react-dom/client';
      import {Inspector} from './src/components/inspection/inspector';
      createRoot(document.getElementById('root')).render(<Inspector manifestUrl="https://model.example.test/manifest.json"/>);`,
    resolveDir: root,
    loader: "tsx",
  },
  bundle: true,
  write: false,
  jsx: "automatic",
  define: { "process.env.NODE_ENV": '"production"' },
  alias: {
    "@/lib/model/loader": path.join(root, "e2e/support/camera-model.ts"),
    "@": path.join(root, "src"),
  },
});
const cssDirectory = path.join(root, ".next/static/chunks");
const cssFiles = (await readdir(cssDirectory)).filter((file) => file.endsWith(".css"));
if (!cssFiles.length) throw new Error("Ejecuta el build de producción antes de validar la cámara.");
const css = (await Promise.all(cssFiles.map((file) => readFile(path.join(cssDirectory, file), "utf8")))).join("\n");
const html = `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>RIKDP-288 · Entorno simulado</title><link rel="stylesheet" href="/style.css"></head><body><main class="mx-auto max-w-6xl p-5"><h1 class="mb-5 text-2xl font-semibold">Validación RIKDP-288 · Cámara y modelo simulados</h1><div id="root"></div></main><script src="/inspector.js"></script></body></html>`;
createServer((request, response) => {
  const asset = request.url === "/inspector.js"
    ? ["text/javascript", outputFiles[0].contents]
    : request.url === "/style.css" ? ["text/css", css] : ["text/html", html];
  response.writeHead(200, { "Content-Type": `${asset[0]}; charset=utf-8` });
  response.end(asset[1]);
}).listen(3101, "127.0.0.1");
