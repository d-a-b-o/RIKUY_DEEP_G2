// Copia los binarios del backend WASM de TensorFlow.js a public/tfjs-wasm/
// para servirlos desde el propio dominio (CSP de HU48). Se ejecuta en postinstall.
import { copyFileSync, mkdirSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const source = join(root, "node_modules/@tensorflow/tfjs-backend-wasm/dist");
const target = join(root, "public/tfjs-wasm");

mkdirSync(target, { recursive: true });
const files = readdirSync(source).filter((name) => name.endsWith(".wasm"));
for (const name of files) copyFileSync(join(source, name), join(target, name));
console.log(`tfjs-wasm: ${files.length} archivos copiados a public/tfjs-wasm`);
