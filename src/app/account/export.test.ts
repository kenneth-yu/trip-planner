import { beforeEach, describe, expect, it, vi } from "vitest";
import { USERS } from "@/fixtures/december-trip";
import { present } from "@/testing/present";
import { testContext } from "@/server/testing";
import { consumeRateLimit, RATE_RULES } from "@/server/security/rate-limit";
import type { ServiceContext } from "@/server/services/context";
import { exportFileName } from "@/server/services/export-service";
import * as exportRoute from "./export/route";

const world = vi.hoisted(() => {
  const state: { ctx: ServiceContext | null; user: { id: string } | null } = { ctx: null, user: null };
  return state;
});

vi.mock("@/server/app-context", () => ({
  requestContext: async () => {
    if (!world.ctx) throw new Error("no test context");
    return world.ctx;
  },
}));

vi.mock("@/server/auth/session", () => ({ currentUser: async () => world.user }));

function post(headers: Record<string, string>) {
  return new Request("https://trips.test/account/export", { method: "POST", headers });
}

const sameSite = { origin: "https://trips.test", host: "trips.test" };

describe("the export download", () => {
  beforeEach(async () => {
    vi.stubEnv("SESSION_SECRET", "test-secret-test-secret-test-secret-0123");
    world.ctx = (await testContext()).ctx;
    world.user = { id: USERS.jacob.id };
  });

  it("only answers POST", () => {
    expect(Object.keys(exportRoute).filter((k) => ["GET", "PUT", "PATCH", "DELETE", "HEAD"].includes(k))).toEqual([]);
    expect(typeof exportRoute.POST).toBe("function");
  });

  it("refuses a request from another site, or with no origin", async () => {
    expect((await exportRoute.POST(post({ origin: "https://evil.example", host: "trips.test" }))).status).toBe(403);
    expect((await exportRoute.POST(post({ host: "trips.test" }))).status).toBe(403);
    expect((await exportRoute.POST(post({ origin: "null", host: "trips.test" }))).status).toBe(403);
  });

  it("refuses a signed out caller", async () => {
    world.user = null;
    expect((await exportRoute.POST(post(sameSite))).status).toBe(401);
  });

  it("sends the file as an attachment named by date only, never cached", async () => {
    const res = await exportRoute.POST(post(sameSite));
    expect(res.status).toBe(200);
    expect(res.headers.get("content-disposition")).toBe(`attachment; filename="${exportFileName(present(world.ctx).now())}"`);
    expect(present(res.headers.get("content-disposition"))).toMatch(/filename="trip-planner-export-\d{4}-\d{2}-\d{2}\.json"/);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(res.headers.get("content-type")).toContain("application/json");
    const name = present(res.headers.get("content-disposition"));
    expect(name).not.toContain("Jacob");
    expect(name).not.toContain("@");
    const text = await res.text();
    expect(text).toBe(JSON.stringify(JSON.parse(text), null, 2));
    expect(Object.keys(JSON.parse(text))).toEqual(["exportedAt", "you", "trips"]);
  });

  it("limits each person, not everyone", async () => {
    const ctx = present(world.ctx);
    for (let i = 0; i < RATE_RULES.dataExport.limit; i++) expect((await exportRoute.POST(post(sameSite))).status).toBe(200);
    const limited = await exportRoute.POST(post(sameSite));
    expect(limited.status).toBe(429);
    expect(Number(limited.headers.get("retry-after"))).toBeGreaterThan(0);
    world.user = { id: USERS.kenny.id };
    expect((await exportRoute.POST(post(sameSite))).status).toBe(200);
    expect((await consumeRateLimit(ctx.db, RATE_RULES.dataExport, "someone-else", ctx.now())).allowed).toBe(true);
  });

  it("answers 503 when the limiter cannot be reached, without exporting", async () => {
    const ctx = present(world.ctx);
    world.ctx = {
      ...ctx,
      db: new Proxy(ctx.db, {
        get(target, prop, receiver) {
          if (prop === "insert") throw new Error("database unavailable");
          return Reflect.get(target, prop, receiver);
        },
      }),
    };
    const res = await exportRoute.POST(post(sameSite));
    expect(res.status).toBe(503);
    expect(await res.text()).not.toContain("trips");
  });
});
