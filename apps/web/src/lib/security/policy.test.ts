import { describe, expect, it } from "vitest";
import { applicationOrigins, contentSecurityPolicy, isSameOriginMutation, isUnsafeMethod } from "./policy";

describe("HU48 security policy", () => {
  it("trusts exact deployment hosts without granting access to other Vercel projects", () => {
    const origins = applicationOrigins({ VERCEL: "1", VERCEL_URL: "rikuy-123.vercel.app",
      NEXT_PUBLIC_SITE_URL: "https://rikuy.example", VERCEL_BRANCH_URL: "rikuy-dev.vercel.app" });
    expect(origins).toEqual(["https://rikuy.example", "https://rikuy-123.vercel.app", "https://rikuy-dev.vercel.app"]);
    expect(isSameOriginMutation(new Headers({ origin: "https://evil.vercel.app" }), origins)).toBe(false);
  });
  it.each([undefined, "null", "https://evil.test", "https://rikuy.example.evil.test", "https://u:p@rikuy.example",
    "https://rikuy.example/path", "https://rikuy.example:8443"])("rejects unsafe mutation origin %s", (origin) => {
    expect(isSameOriginMutation(new Headers(origin ? { origin } : {}), ["https://rikuy.example"])).toBe(false);
  });
  it("allows same-origin writes and rejects cross-site Fetch Metadata", () => {
    const headers = new Headers({ origin: "https://rikuy.example" });
    expect(isSameOriginMutation(headers, ["https://rikuy.example"])).toBe(true);
    headers.set("sec-fetch-site", "cross-site");
    expect(isSameOriginMutation(headers, ["https://rikuy.example"])).toBe(false);
    expect(isUnsafeMethod("POST")).toBe(true);
    expect(isUnsafeMethod("GET")).toBe(false);
  });
  it("uses nonces and WASM without allowing production JavaScript eval or inline scripts", () => {
    const csp = contentSecurityPolicy("randomNonce123", { NODE_ENV: "production",
      NEXT_PUBLIC_MODEL_MANIFEST_URL: "https://models.example/v1/manifest.json",
      R2_ENDPOINT_URL: "https://images.example" });
    const script = csp.split(";").find((directive) => directive.trim().startsWith("script-src "))!;
    expect(script).toContain("'nonce-randomNonce123'");
    expect(script).toContain("'wasm-unsafe-eval'");
    expect(script).not.toContain("'unsafe-inline'");
    expect(script).not.toContain("'unsafe-eval'");
    expect(csp).toContain("https://models.example");
    expect(csp).toContain("https://images.example");
    expect(csp).not.toContain("manifest.json");
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toContain("form-action 'self'");
  });
  it("never accepts a caller supplied invalid nonce", () => {
    expect(() => contentSecurityPolicy("bad'; script-src *")).toThrow();
  });
});
