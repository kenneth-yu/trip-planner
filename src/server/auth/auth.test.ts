import { beforeAll, describe, expect, it } from "vitest";
import { decryptSecret, encryptSecret, generateToken, hashToken } from "./tokens";
import { openSession, sealSession } from "./session";
import { accessTokenSource, openState, sealState } from "../google/oauth";

beforeAll(() => {
  process.env.SESSION_SECRET = "test-secret-test-secret-test-secret-0123";
  process.env.TOKEN_ENCRYPTION_KEY = Buffer.alloc(32, 7).toString("base64");
});

describe("tokens", () => {
  it("are long, random and stored only as hashes", () => {
    const [a, b] = [generateToken("tpa"), generateToken("tpa")];
    expect(a).not.toBe(b);
    expect(a.length).toBeGreaterThan(45);
    expect(hashToken(a)).toMatch(/^[0-9a-f]{64}$/);
  });

  it("refresh tokens round trip through encryption and tampering is detected", () => {
    const sealed = encryptSecret("1//refresh-token");
    expect(sealed).not.toContain("refresh");
    expect(decryptSecret(sealed)).toBe("1//refresh-token");
    const [iv, tag, body] = sealed.split(".");
    expect(() => decryptSecret([iv, tag, body.slice(0, -2) + "AA"].join("."))).toThrow();
  });
});

describe("session cookie", () => {
  it("opens what it sealed, rejects edits and expiry", () => {
    const now = Date.UTC(2026, 10, 26);
    const v = sealSession("user-1", now);
    expect(openSession(v, now)).toBe("user-1");
    expect(openSession(v.replace("user-1", "user-2"), now)).toBeNull();
    expect(openSession(v, now + 31 * 86400_000)).toBeNull();
    expect(openSession(undefined, now)).toBeNull();
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
