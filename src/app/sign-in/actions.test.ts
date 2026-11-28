import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createPgliteDb, type Db } from "@/server/db/client";

const env = vi.hoisted(() => {
  const state: { db: Promise<Db> | null; storeDown: boolean; forwardedFor: string; signIns: string[] } = { db: null, storeDown: false, forwardedFor: "203.0.113.7", signIns: [] };
  return state;
});

vi.mock("next/headers", () => ({ headers: async () => new Headers({ "x-forwarded-for": env.forwardedFor }) }));

vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw new Error(`redirect ${url}`);
  },
}));

vi.mock("@/server/db/client", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/server/db/client")>();
  return {
    ...real,
    getDb: () => {
      if (env.storeDown) return Promise.reject(new Error("connect ECONNREFUSED postgres://user:secret@db.internal/trips"));
      env.db ??= real.createPgliteDb();
      return env.db;
    },
  };
});

vi.mock("@/server/auth/auth", () => ({
  signIn: async (provider: string) => {
    env.signIns.push(provider);
    if (provider === "email") return "http://localhost/api/auth/verify-request";
    throw new Error("redirect https://accounts.google.com/o/oauth2");
  },
}));

import { continueWithProvider, sendEmailLink } from "./actions";

beforeAll(() => {
  vi.useFakeTimers({ toFake: ["Date"], now: new Date("2026-11-27T10:07:30.000Z") });
});

afterAll(() => {
  vi.useRealTimers();
});

function emailForm() {
  const form = new FormData();
  form.set("email", "kenny@example.test");
  return form;
}

function googleForm() {
  const form = new FormData();
  form.set("provider", "google");
  return form;
}

beforeEach(() => {
  env.db = createPgliteDb();
  env.storeDown = false;
  env.forwardedFor = "203.0.113.7";
  env.signIns = [];
  vi.stubEnv("SESSION_SECRET", "test-secret-test-secret-test-secret-0123");
  vi.stubEnv("TRUST_PROXY", "1");
  vi.stubEnv("EMAIL_API_KEY", "test-only");
  vi.stubEnv("EMAIL_FROM", "trips@example.test");
  vi.stubEnv("GOOGLE_CLIENT_ID", "test-only");
  vi.stubEnv("GOOGLE_CLIENT_SECRET", "test-only");
});

describe("sign in actions are rate limited where they run", () => {
  it("sends 10 email links from one address in 15 minutes, then says to wait without sending", async () => {
    const states = [];
    for (let i = 0; i < 11; i++) states.push((await sendEmailLink({ status: "idle" }, emailForm())).status);
    expect(states.slice(0, 10).every((s) => s === "sent")).toBe(true);
    expect(states[10]).toBe("limited");
    expect(env.signIns).toHaveLength(10);
  });

  it("counts provider sign in against the same budget and sends the 11th back to the sign in screen", async () => {
    for (let i = 0; i < 5; i++) await sendEmailLink({ status: "idle" }, emailForm());
    for (let i = 0; i < 5; i++) await expect(continueWithProvider(googleForm())).rejects.toThrow("accounts.google.com");
    await expect(continueWithProvider(googleForm())).rejects.toThrow("redirect /sign-in?error=TooMany");
    expect(env.signIns).toHaveLength(10);
  });

  it("keeps other addresses unaffected", async () => {
    for (let i = 0; i < 11; i++) await sendEmailLink({ status: "idle" }, emailForm());
    env.forwardedFor = "198.51.100.4";
    expect((await sendEmailLink({ status: "idle" }, emailForm())).status).toBe("sent");
  });

  it("refuses to sign in when the limit cannot be checked, says so calmly and logs no details", async () => {
    env.storeDown = true;
    const logged = vi.spyOn(console, "error").mockImplementation(() => undefined);
    expect((await sendEmailLink({ status: "idle" }, emailForm())).status).toBe("failed");
    await expect(continueWithProvider(googleForm())).rejects.toThrow("redirect /sign-in?error=Unavailable");
    expect(env.signIns).toEqual([]);
    const lines = JSON.stringify(logged.mock.calls);
    expect(lines).not.toContain("secret");
    expect(lines).not.toContain("203.0.113.7");
    expect(lines).not.toContain("kenny@example.test");
    logged.mockRestore();
  });
});
