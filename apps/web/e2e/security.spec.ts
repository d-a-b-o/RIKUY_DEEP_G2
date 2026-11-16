import { randomBytes } from "node:crypto";
import { build } from "esbuild";
import { expect, test } from "@playwright/test";

test("@smoke @security HU48: CSP nonce, cabeceras, hidratación y compatibilidad WASM/WebGL", async ({ page, request }) => {
  const violations: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error" && /content security policy/i.test(message.text())) violations.push(message.text());
  });
  await page.addInitScript(() => localStorage.setItem("rikuy-theme", "dark"));
  const response = await page.goto("/");
  expect(response?.status()).toBe(200);
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await page.getByRole("button", { name: "Cambiar entre modo claro y oscuro" }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  const headers = response!.headers();
  expect(headers["strict-transport-security"]).toBe("max-age=31536000");
  expect(headers["x-content-type-options"]).toBe("nosniff");
  expect(headers["x-frame-options"]).toBe("DENY");
  expect(headers["permissions-policy"]).toContain("camera=(self)");
  expect(headers["x-powered-by"]).toBeUndefined();
  const nonce = headers["content-security-policy"].match(/'nonce-([^']+)'/)![1];
  const next = await request.get("/");
  expect(next.headers()["content-security-policy"]).not.toBe(headers["content-security-policy"]);
  const scripts = await page.locator("script").evaluateAll((items) => (items as HTMLScriptElement[]).filter((item) =>
    !item.type || item.type === "text/javascript").map((item) => item.nonce));
  expect(scripts.length).toBeGreaterThan(1);
  expect(scripts.every((value) => value === nonce)).toBe(true);
  const compatibility = await page.evaluate(async () => {
    await WebAssembly.compile(new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0]));
    const gl = document.createElement("canvas").getContext("webgl2");
    if (!gl) return { wasm: true, webgl: false };
    const shader = gl.createShader(gl.VERTEX_SHADER)!;
    gl.shaderSource(shader, "#version 300 es\nvoid main(){gl_Position=vec4(0.0);}");
    gl.compileShader(shader);
    return { wasm: true, webgl: Boolean(gl.getShaderParameter(shader, gl.COMPILE_STATUS)) };
  });
  expect(compatibility).toEqual({ wasm: true, webgl: true });
  expect(violations).toEqual([]);
  const bundle = await build({
    stdin: { resolveDir: process.cwd(), contents: `
      import * as tf from "@tensorflow/tfjs-core";
      import { setWasmPaths } from "@tensorflow/tfjs-backend-wasm";
      import "@tensorflow/tfjs-backend-webgl";
      setWasmPaths("/tfjs-wasm/");
      (async () => {
        try {
          const results = {};
          for (const backend of ["wasm", "webgl"]) {
            if (!await tf.setBackend(backend)) throw new Error("Backend unavailable: " + backend);
            await tf.ready();
            const result = tf.tidy(() => tf.add(tf.tensor1d([1,2]), tf.tensor1d([3,4])));
            results[backend] = Array.from(await result.data());
            result.dispose();
          }
          window.hu48Tensorflow = { results };
        } catch (error) { window.hu48Tensorflow = { error: String(error) }; }
      })();
    ` },
    bundle: true, write: false, format: "iife", platform: "browser",
    define: { "process.env.NODE_ENV": '"production"' },
  });
  await page.route("**/hu48-tfjs-probe.js", (route) => route.fulfill({
    contentType: "application/javascript", body: bundle.outputFiles[0].text,
  }));
  // Inject into the HTTP document, not through CDP evaluate (which has privileged execution).
  await page.route(page.url(), async (route) => {
    const original = await route.fetch();
    const documentNonce = original.headers()["content-security-policy"].match(/'nonce-([^']+)'/)![1];
    const body = (await original.text()).replace("<head>",
      `<head><script>document.documentElement.dataset.hu48Injected="yes"</script><script nonce="${documentNonce}" src="/hu48-tfjs-probe.js"></script>`);
    await route.fulfill({ response: original, body });
  });
  await page.reload();
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  expect(await page.locator("html").getAttribute("data-hu48-injected")).toBeNull();
  expect(violations.length).toBeGreaterThan(0);
  await page.waitForFunction(() => "hu48Tensorflow" in window);
  const tensorflow = await page.evaluate(() => (window as unknown as {
    hu48Tensorflow: { results?: Record<string, number[]>; error?: string };
  }).hu48Tensorflow);
  expect(tensorflow).toEqual({ results: { wasm: [4, 6], webgl: [4, 6] } });
});

test("@smoke @security HU48: CSRF se rechaza antes de invocar una acción o autenticar", async ({ request }) => {
  for (const path of ["/", "/invitacion", "/panel/catalogos", "/api/auth/sign-in/email"]) {
    const response = await request.post(path, { headers: { origin: "https://evil.vercel.app" }, data: {} });
    expect(response.status()).toBe(403);
    expect(await response.json()).toEqual({ error: "CSRF_REJECTED" });
  }
  const missing = await request.post("/", { data: {} });
  expect(missing.status()).toBe(403);
});

test("@smoke @security HU48: cuota HTTP distribuida devuelve 429 y Retry-After", async ({ request, baseURL }) => {
  test.skip(!process.env.DATABASE_URL, "Requiere PostgreSQL de pruebas");
  test.skip(!["localhost", "127.0.0.1"].includes(new URL(baseURL!).hostname), "IP control is only valid at local test ingress");
  const ip = "2001:db8:" + randomBytes(12).toString("hex").match(/.{4}/g)!.join(":");
  const headers = { origin: new URL(baseURL!).origin, "x-forwarded-for": ip };
  const responses = [];
  for (let n = 0; n < 6; n++) {
    // Nonexistent route exercises the boundary without writing business data.
    responses.push(await request.post("/hu48-quota-probe", { headers, data: "" }));
  }
  expect(responses[4].status()).not.toBe(429);
  expect(responses[5].status()).toBe(429);
  expect(Number(responses[5].headers()["retry-after"])).toBeGreaterThan(0);
});
