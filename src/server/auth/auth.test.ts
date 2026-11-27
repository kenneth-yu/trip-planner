import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { decryptSecret, encryptSecret, generateToken, hashToken } from "./tokens";
import { accessTokenSource, openState, sealState } from "../google/oauth";
import { createAdapter, generateSessionToken } from "./adapter";
import { sessionCookieName } from "./config";
import { currentUser, devSignInEnabled, userForSessionToken } from "./session";
import { testContext } from "../testing";
import * as t from "../db/schema";
import { present } from "@/testing/present";
import { USERS } from "@/fixtures/december-trip";
import type { Db } from "../db/client";

const jar = new Map<string, { value: string; options: Record<string, unknown> }>();
const database: { current: Promise<Db> | null } = { current: null };

vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) => (jar.has(name) ? { name, value: present(jar.get(name)).value } : undefined),
    set: (name: string, value: string, options: Record<string, unknown>) => {
      jar.set(name, { value, options });
    },
  }),
}));

vi.mock("../db/client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../db/client")>()),
  getDb: () => present(database.current),
}));

beforeAll(async () => {
  database.current = testContext({ withItems: false }).then((c) => c.db);
  await database.current;
  process.env.SESSION_SECRET = "test-secret-test-secret-test-secret-0123";
  process.env.TOKEN_ENCRYPTION_KEY = Buffer.alloc(32, 7).toString("base64");
});

beforeEach(async () => {
  jar.clear();
  await (await present(database.current)).delete(t.authSessions);
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("tokens", () => {
  it("are long, random and stored only as hashes", () => {
    const [a, b] = [generateToken("tpa"), generateToken("tpa")];
    expect(a).not.toBe(b);
    expect(a.length).toBeGreaterThan(45);
    expect(hashToken(a)).toMatch(/^[0-9a-f]{64}$/);
  });

  it("session tokens are 32 random bytes", () => {
    expect(generateSessionToken()).not.toBe(generateSessionToken());
    expect(Buffer.from(generateSessionToken(), "base64url")).toHaveLength(32);
  });

  it("refresh tokens round trip through encryption and tampering is detected", () => {
    const sealed = encryptSecret("1//refresh-token");
    expect(sealed).not.toContain("refresh");
    expect(decryptSecret(sealed)).toBe("1//refresh-token");
    const [iv, tag, body] = sealed.split(".");
    expect(() => decryptSecret([iv, tag, body.slice(0, -2) + "AA"].join("."))).toThrow();
  });
});

describe("current user", () => {
  async function signedInCookie(userId: string, expires = new Date(Date.now() + 86400_000)) {
    const db = await present(database.current);
    const token = generateSessionToken();
    await present(createAdapter(db).createSession)({ sessionToken: token, userId, expires });
    jar.set(sessionCookieName(process.env), { value: token, options: {} });
    return token;
  }

  it("resolves a hashed session from the cookie", async () => {
    await signedInCookie(USERS.kenny.id);
    expect((await currentUser())?.email).toBe(USERS.kenny.email);
  });

  it("is null without a cookie, with an unknown cookie and with a tampered cookie", async () => {
    expect(await currentUser()).toBeNull();
    const token = await signedInCookie(USERS.kenny.id);
    jar.set(sessionCookieName(process.env), { value: `${token}x`, options: {} });
    expect(await currentUser()).toBeNull();
    jar.set(sessionCookieName(process.env), { value: hashToken(token), options: {} });
    expect(await currentUser()).toBeNull();
    jar.set(sessionCookieName(process.env), { value: "unknown", options: {} });
    expect(await currentUser()).toBeNull();
  });

  it("ignores the retired signed cookie format", async () => {
    jar.set("tp_session", { value: `${USERS.kenny.id}.9999999999.mac`, options: {} });
    expect(await currentUser()).toBeNull();
  });

  it("is null for an expired session", async () => {
    await signedInCookie(USERS.kenny.id, new Date(Date.now() - 1000));
    expect(await currentUser()).toBeNull();
  });

  it("userForSessionToken handles a missing token", async () => {
    expect(await userForSessionToken(await present(database.current), undefined)).toBeNull();
  });

  it("uses a secure, prefixed cookie name in production only", () => {
    expect(sessionCookieName({ NODE_ENV: "production" })).toBe("__Secure-authjs.session-token");
    expect(sessionCookieName({ NODE_ENV: "development" })).toBe("authjs.session-token");
  });
});

describe("devSignInEnabled", () => {
  it("is false unless DEV_SIGN_IN is 1", () => {
    expect(devSignInEnabled({ NODE_ENV: "development" })).toBe(false);
    expect(devSignInEnabled({ NODE_ENV: "production", VERCEL_ENV: "production" })).toBe(false);
    expect(devSignInEnabled({ DEV_SIGN_IN: "0", NODE_ENV: "development" })).toBe(false);
  });

  it("is true in development and on Vercel previews", () => {
    expect(devSignInEnabled({ DEV_SIGN_IN: "1", NODE_ENV: "development" })).toBe(true);
    expect(devSignInEnabled({ DEV_SIGN_IN: "1", NODE_ENV: "test" })).toBe(true);
    expect(devSignInEnabled({ DEV_SIGN_IN: "1", NODE_ENV: "production", VERCEL_ENV: "preview" })).toBe(true);
    expect(devSignInEnabled({ DEV_SIGN_IN: "1", NODE_ENV: "development", VERCEL_ENV: "development" })).toBe(true);
  });

  it("throws in production with no Vercel environment", () => {
    expect(() => devSignInEnabled({ DEV_SIGN_IN: "1", NODE_ENV: "production" })).toThrow(/DEV_SIGN_IN/);
  });

  it("throws on a Vercel production deployment, whatever NODE_ENV says", () => {
    expect(() => devSignInEnabled({ DEV_SIGN_IN: "1", NODE_ENV: "production", VERCEL_ENV: "production" })).toThrow(/DEV_SIGN_IN/);
    expect(() => devSignInEnabled({ DEV_SIGN_IN: "1", NODE_ENV: "development", VERCEL_ENV: "production" })).toThrow(/DEV_SIGN_IN/);
  });
});

describe("google oauth", () => {
  it("state is bound to the signed in user and expires", () => {
    const now = Date.now();
    const s = sealState({ userId: "u1", tripId: "t1", exp: now + 60_000 });
    expect(openState(s, "u1", now)).toEqual({ userId: "u1", tripId: "t1", exp: now + 60_000 });
    expect(openState(s, "u2", now)).toBeNull();
    expect(openState(s, "u1", now + 120_000)).toBeNull();
  });

  it("caches the access token until shortly before it expires", async () => {
    let calls = 0;
    let clock = 0;
    const fakeFetch: typeof fetch = async () => {
      calls++;
      return new Response(JSON.stringify({ access_token: `at${calls}`, expires_in: 3600, scope: "x" }), { status: 200 });
    };
    const get = accessTokenSource({ clientId: "c", clientSecret: "s", redirectUri: "r" }, "rt", fakeFetch, () => clock);
    expect(await get()).toBe("at1");
    clock = 3000_000;
    expect(await get()).toBe("at1");
    clock = 3560_000;
    expect(await get()).toBe("at2");
  });
});
