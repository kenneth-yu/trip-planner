import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { createPgliteDb } from "@/server/db/client";

const store = vi.hoisted(() => {
  const state: { db: ReturnType<typeof createPgliteDb> | null } = { db: null };
  return state;
});

vi.mock("@/server/db/client", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/server/db/client")>();
  return {
    ...real,
    getDb: () => {
      store.db ??= real.createPgliteDb();
      return store.db;
    },
  };
});

import { proxy } from "@/proxy";

beforeAll(() => {
  process.env.SESSION_SECRET = "test-secret-test-secret-test-secret-0123";
});

async function statuses(method: string, url: string, times: number) {
  const out: number[] = [];
  for (let i = 0; i < times; i++) out.push((await proxy(new NextRequest(url, { method }))).status);
  return out;
}

describe("proxy rate limits sign in", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-11-27T10:07:30Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("refuses POST /api/auth/signin/email after 10 in 15 minutes", async () => {
    store.db = createPgliteDb();
    const seen = await statuses("POST", "https://trips.test/api/auth/signin/email", 11);
    expect(seen.slice(0, 10).every((s) => s === 200)).toBe(true);
    expect(seen[10]).toBe(429);
  });

  it("leaves page POSTs to the actions, so signing out on the home page spends nothing", async () => {
    store.db = createPgliteDb();
    expect((await statuses("POST", "https://trips.test/", 12)).every((s) => s === 200)).toBe(true);
    expect(await statuses("POST", "https://trips.test/api/auth/signin/email", 1)).toEqual([200]);
  });

  it("does not limit reading the sign in page", async () => {
    store.db = createPgliteDb();
    const seen = await statuses("GET", "https://trips.test/sign-in", 12);
    expect(seen.every((s) => s === 200)).toBe(true);
  });
});

describe("proxy request path", () => {
  it("forwards the real path and query as x-request-path, overwriting what the client sent", async () => {
    const request = new NextRequest("https://trips.test/trips/abc/inbox?day=2026-12-05", { headers: { "x-request-path": "/somewhere-else" } });
    const res = await proxy(request);
    expect(res.headers.get("x-middleware-request-x-request-path")).toBe("/trips/abc/inbox?day=2026-12-05");
    expect(res.headers.get("x-middleware-override-headers")).toContain("x-request-path");
  });
});
