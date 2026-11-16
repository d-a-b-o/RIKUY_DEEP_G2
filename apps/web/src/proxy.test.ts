import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
const mocks = vi.hoisted(() => ({ limit: vi.fn(), configured: vi.fn(), access: vi.fn(), cookie: vi.fn() }));
vi.mock("@/lib/security/write-limit", () => ({ consumeWriteLimit: mocks.limit,
  writeLimitKey: () => "hashed", writePolicy: () => ({ bucket: "public", max: 5, windowMs: 600_000 }) }));
vi.mock("@/lib/db", () => ({ isDatabaseConfigured: mocks.configured }));
vi.mock("@/lib/authz/route-access", () => ({ checkRouteAccess: mocks.access }));
vi.mock("better-auth/cookies", () => ({ getSessionCookie: mocks.cookie }));
import { proxy } from "./proxy";

beforeEach(() => {
  vi.stubEnv("NEXT_PUBLIC_SITE_URL", "https://rikuy.example");
  mocks.limit.mockReset();
  mocks.limit.mockResolvedValue({ allowed: true, retryAfter: 10 });
  mocks.configured.mockReturnValue(true);
  mocks.access.mockResolvedValue({ allowed: true });
  mocks.cookie.mockReturnValue("session");
  vi.unstubAllGlobals();
});

function post(headers: Record<string, string> = {}, path = "/") {
  return new NextRequest("https://rikuy.example" + path, { method: "POST", headers });
}

describe("HU48 request boundary", () => {
  it("rejects cross-origin and missing Origin before accessing storage or dispatching an action", async () => {
    for (const origin of [undefined, "https://evil.vercel.app"]) {
      const response = await proxy(post(origin ? { origin } : {}));
      expect(response.status).toBe(403);
    }
    expect(mocks.limit).not.toHaveBeenCalled();
  });
  it("limits progressively enhanced forms without depending on a Next-Action header", async () => {
    mocks.limit.mockResolvedValue({ allowed: false, retryAfter: 45 });
    const response = await proxy(post({ origin: "https://rikuy.example" }));
    expect(response.status).toBe(429);
    expect(response.headers.get("retry-after")).toBe("45");
    expect(response.headers.get("cache-control")).toBe("private, no-store");
  });
  it("fails closed when the distributed limiter is unavailable", async () => {
    mocks.limit.mockRejectedValue(new Error("offline"));
    expect((await proxy(post({ origin: "https://rikuy.example" }))).status).toBe(503);
  });
  it("uses Better Auth's existing DB limiter for auth, but still checks CSRF", async () => {
    expect((await proxy(post({}, "/api/auth/sign-in/email"))).status).toBe(403);
    await proxy(post({ origin: "https://rikuy.example" }, "/api/auth/sign-in/email"));
    expect(mocks.limit).not.toHaveBeenCalled();
  });
  it("preserves session redirects and forwards the nonce to private pages", async () => {
    mocks.cookie.mockReturnValueOnce(null);
    const request = new NextRequest("https://rikuy.example/panel/catalogos");
    expect((await proxy(request)).headers.get("location")).toContain("/ingresar?next=");
    const allowed = await proxy(new NextRequest(request));
    const nonce = allowed.headers.get("content-security-policy")!.match(/'nonce-([^']+)'/)![1];
    expect(allowed.headers.get("x-middleware-request-x-nonce")).toBe(nonce);
  });
  it("keeps the nonce belonging to a fetched 403 document", async () => {
    mocks.access.mockResolvedValue({ allowed: false, forbiddenPath: "/panel/sin-permiso" });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response('<script nonce="inner">trusted</script>', {
      headers: { "content-security-policy": "script-src 'nonce-inner'", "content-type": "text/html" },
    })));
    const response = await proxy(new NextRequest("https://rikuy.example/panel/catalogos"));
    expect(response.status).toBe(403);
    expect(response.headers.get("content-security-policy")).toBe("script-src 'nonce-inner'");
  });
  it("replaces attacker-provided nonce/CSP, producing a different nonce for every document", async () => {
    const request = () => new NextRequest("https://rikuy.example/", {
      headers: { "x-nonce": "attacker", "content-security-policy": "script-src *" },
    });
    const first = await proxy(request());
    const second = await proxy(request());
    const csp = first.headers.get("content-security-policy")!;
    expect(csp).toContain("'nonce-");
    expect(csp).not.toContain("attacker");
    expect(csp).not.toBe(second.headers.get("content-security-policy"));
  });
});
