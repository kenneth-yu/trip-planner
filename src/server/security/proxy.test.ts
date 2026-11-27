import { afterEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

vi.mock("@/server/db/client", () => ({
  getDb: () => Promise.reject(new Error("connection refused postgres://user:secret@host/db")),
}));

import { proxy } from "@/proxy";

describe("proxy when the rate limit store fails", () => {
  afterEach(() => vi.restoreAllMocks());

  it("answers 503 with security headers and fixed copy, and logs no error details", async () => {
    const logged = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const res = await proxy(new NextRequest("https://trips.test/api/mcp/x"));
    expect(res.status).toBe(503);
    expect(res.headers.get("content-security-policy")).toContain("nonce-");
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    expect(res.headers.get("retry-after")).toBe("30");
    const body = await res.text();
    expect(body).not.toContain("postgres");
    expect(JSON.stringify(logged.mock.calls)).not.toContain("secret");
  });

  it("does not touch the store for paths without a rule", async () => {
    const res = await proxy(new NextRequest("https://trips.test/"));
    expect(res.status).toBe(200);
  });
});
