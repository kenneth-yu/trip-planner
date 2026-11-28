import { describe, expect, it } from "vitest";
import { securityHeaders } from "./headers";

const csp = (path: string, isProd: boolean) => securityHeaders(path, "bm9uY2U=", isProd).get("content-security-policy") ?? "";

describe("securityHeaders", () => {
  it("puts the nonce in script-src and allows no inline or eval scripts in production", () => {
    const policy = csp("/", true);
    expect(policy).toContain("script-src 'self' 'nonce-bm9uY2U=' 'strict-dynamic'");
    expect(policy).not.toMatch(/script-src[^;]*'unsafe-(inline|eval)'/);
  });

  it("locks down framing, base, objects and form targets", () => {
    const policy = csp("/trips/abc", true);
    expect(policy).toContain("frame-ancestors 'none'");
    expect(policy).toContain("base-uri 'none'");
    expect(policy).toContain("object-src 'none'");
    expect(policy).toContain("form-action 'self' https://accounts.google.com https://appleid.apple.com");
    expect(policy).toContain("default-src 'self'");
    expect(policy).toContain("connect-src 'self'");
  });

  it("allows the phone frame and dev tooling only in development", () => {
    const dev = csp("/", false);
    expect(dev).toContain("frame-ancestors http://localhost:8766");
    expect(dev).toContain("'unsafe-eval'");
    expect(dev).toContain("connect-src 'self' ws://localhost:*");
    expect(dev).not.toMatch(/ ws: /);
    const prod = csp("/", true);
    expect(prod).not.toContain("localhost");
    expect(prod).not.toContain("unsafe-eval");
  });

  it("sends the baseline headers on every path", () => {
    const h = securityHeaders("/anything", "n", true);
    expect(h.get("x-content-type-options")).toBe("nosniff");
    expect(h.get("referrer-policy")).toBe("strict-origin-when-cross-origin");
    expect(h.get("permissions-policy")).toBe("camera=(), microphone=(), geolocation=()");
    expect(h.get("cross-origin-opener-policy")).toBe("same-origin");
    expect(h.get("x-robots-tag")).toBeNull();
  });

  it("keeps view link pages out of every cache, and leaves other pages alone", () => {
    expect(securityHeaders("/v/abc", "bm9uY2U=", true).get("cache-control")).toBe("private, no-store");
    expect(securityHeaders("/trips/x", "bm9uY2U=", true).get("cache-control")).toBeNull();
  });

  it.each(["/v/abc", "/invite/abc"])("%s is noindex and sends no referrer", (path) => {
    const h = securityHeaders(path, "n", true);
    expect(h.get("referrer-policy")).toBe("no-referrer");
    expect(h.get("x-robots-tag")).toBe("noindex, nofollow");
  });

  it("sends HSTS only in production", () => {
    expect(securityHeaders("/", "n", true).get("strict-transport-security")).toBe("max-age=63072000; includeSubDomains");
    expect(securityHeaders("/", "n", false).get("strict-transport-security")).toBeNull();
  });
});
