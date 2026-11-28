import { beforeAll, describe, expect, it } from "vitest";
import { IMPORT_SCOPE, MIRROR_SCOPE } from "./calendar-api";
import { createHash } from "node:crypto";
import { present } from "@/testing/present";
import { encryptSecret } from "../auth/tokens";
import { emailFromIdToken, exchangeImportCode, IMPORT_WINDOW_MS, ImportConsentMissing, openImportFlow, openImportHeld, openImportState, openImportToken, sealImportState, sealImportToken, startImportFlow } from "./import-oauth";
import { authorizationUrl, openState, sealState, type GoogleOAuthConfig } from "./oauth";

const cfg: GoogleOAuthConfig = { clientId: "client", clientSecret: "secret", redirectUri: "https://trips.test/api/google/import/callback" };
const USER = "00000000-0000-4000-8000-0000000000a1";
const TRIP = "00000000-0000-4000-8300-000000000001";
const NOW = Date.parse("2026-11-27T12:00:00Z");

beforeAll(() => {
  process.env.SESSION_SECRET = "test-secret-test-secret-test-secret-0123";
  process.env.TOKEN_ENCRYPTION_KEY = Buffer.alloc(32, 7).toString("base64");
});

describe("asking Google for read access", () => {
  it("asks for the calendar read scope only, online, without earlier grants", () => {
    const url = new URL(authorizationUrl(cfg, IMPORT_SCOPE, "state", "kenny@example.test", { offline: false }));
    expect(url.searchParams.get("scope")).toBe(`openid email ${IMPORT_SCOPE}`);
    expect(url.searchParams.get("access_type")).toBe("online");
    expect(url.searchParams.get("include_granted_scopes")).toBe("false");
    expect(url.searchParams.get("redirect_uri")).toBe(cfg.redirectUri);
  });

  it("still asks for an offline refresh token for the mirror", () => {
    expect(new URL(authorizationUrl(cfg, MIRROR_SCOPE, "state")).searchParams.get("access_type")).toBe("offline");
  });

  it("adds a PKCE challenge only when one is given", () => {
    const withChallenge = new URL(authorizationUrl(cfg, IMPORT_SCOPE, "state", undefined, { offline: false, challenge: "abc" }));
    expect(withChallenge.searchParams.get("code_challenge")).toBe("abc");
    expect(withChallenge.searchParams.get("code_challenge_method")).toBe("S256");
    expect(new URL(authorizationUrl(cfg, MIRROR_SCOPE, "state")).searchParams.has("code_challenge")).toBe(false);
  });

  it("keeps the import scope away from sign in: it is only ever used with this call", () => {
    expect(IMPORT_SCOPE).toBe("https://www.googleapis.com/auth/calendar.readonly");
  });
});

describe("the state that comes back from Google", () => {
  const state = { userId: USER, tripId: TRIP, exp: NOW + IMPORT_WINDOW_MS, nonce: "n".repeat(32) };

  it("opens for the same person before it expires", () => {
    expect(openImportState(sealImportState(state), USER, NOW)).toEqual(state);
  });

  it.each([
    ["another person", (s: string) => ({ value: s, user: "someone-else", now: NOW })],
    ["after it expired", (s: string) => ({ value: s, user: USER, now: NOW + IMPORT_WINDOW_MS + 1 })],
    ["with the body changed", (s: string) => ({ value: `${Buffer.from(JSON.stringify({ ...state, tripId: "other" })).toString("base64url")}.${s.split(".")[1]}`, user: USER, now: NOW })],
    ["with no signature", (s: string) => ({ value: s.split(".")[0], user: USER, now: NOW })],
    ["empty", () => ({ value: "", user: USER, now: NOW })],
  ])("does not open %s", (_name, make) => {
    const attempt = make(sealImportState(state));
    expect(openImportState(attempt.value, attempt.user, attempt.now)).toBeNull();
  });

  it("is not interchangeable with the state of the calendar mirror", () => {
    expect(openState(sealImportState(state), USER, NOW)).toBeNull();
    expect(openImportState(sealState(state), USER, NOW)).toBeNull();
  });
});

describe("the flow cookie that binds the callback to the browser that started it", () => {
  it("opens for the state it was started with, and the challenge is the hash of the verifier it holds", () => {
    const flow = startImportFlow(USER, TRIP, NOW);
    const held = openImportFlow(flow.cookie.value, present(openImportState(flow.state, USER, NOW)), NOW);
    expect(held?.verifier).toMatch(/^[A-Za-z0-9_-]{64}$/);
    expect(createHash("sha256").update(held?.verifier ?? "").digest("base64url")).toBe(flow.challenge);
    expect(flow.cookie.maxAgeS).toBe(IMPORT_WINDOW_MS / 1000);
  });

  it("does not open for the state of another start, another person, another trip, or after it expired", () => {
    const flow = startImportFlow(USER, TRIP, NOW);
    const other = present(openImportState(startImportFlow(USER, TRIP, NOW).state, USER, NOW));
    expect(openImportFlow(flow.cookie.value, other, NOW)).toBeNull();
    const mine = present(openImportState(flow.state, USER, NOW));
    expect(openImportFlow(flow.cookie.value, { ...mine, userId: "someone-else" }, NOW)).toBeNull();
    expect(openImportFlow(flow.cookie.value, { ...mine, tripId: "other" }, NOW)).toBeNull();
    expect(openImportFlow(flow.cookie.value, mine, NOW + IMPORT_WINDOW_MS + 1)).toBeNull();
  });

  it("does not open when it is missing, damaged, or not JSON", () => {
    const mine = present(openImportState(startImportFlow(USER, TRIP, NOW).state, USER, NOW));
    expect(openImportFlow(undefined, mine, NOW)).toBeNull();
    expect(openImportFlow("not a cookie", mine, NOW)).toBeNull();
    expect(openImportFlow(encryptSecret("not json"), mine, NOW)).toBeNull();
  });
});

describe("exchanging the code", () => {
  const fetchWith = (scope: string, extra: Record<string, unknown> = {}) => async () => new Response(JSON.stringify({ access_token: "ya29.read", expires_in: 3599, scope, ...extra }), { status: 200 });

  it("sends the PKCE verifier with the code", async () => {
    const bodies: string[] = [];
    await exchangeImportCode(cfg, "code", "the-verifier", async (_url, init) => {
      bodies.push(String(init?.body));
      return new Response(JSON.stringify({ access_token: "t", expires_in: 3599, scope: IMPORT_SCOPE }), { status: 200 });
    });
    expect(new URLSearchParams(bodies[0]).get("code_verifier")).toBe("the-verifier");
  });

  it("returns an access token and keeps nothing else, and needs no refresh token", async () => {
    const held = await exchangeImportCode(cfg, "code", "verifier", fetchWith(`openid email ${IMPORT_SCOPE}`));
    expect(held).toEqual({ accessToken: "ya29.read", expiresInS: 3599 });
  });

  it("never returns a refresh token even when Google sends one", async () => {
    const held = await exchangeImportCode(cfg, "code", "verifier", fetchWith(`openid ${IMPORT_SCOPE}`, { refresh_token: "1//refresh" }));
    expect(JSON.stringify(held)).not.toContain("refresh");
  });

  it("refuses a grant that does not include the read scope", async () => {
    await expect(exchangeImportCode(cfg, "code", "verifier", fetchWith("openid email"))).rejects.toThrow(ImportConsentMissing);
    await expect(exchangeImportCode(cfg, "code", "verifier", fetchWith(MIRROR_SCOPE))).rejects.toThrow(ImportConsentMissing);
  });
});

describe("naming the Google account", () => {
  const idToken = (claims: unknown) => `h.${Buffer.from(JSON.stringify(claims)).toString("base64url")}.s`;

  it("reads the email claim of the id token", () => {
    expect(emailFromIdToken(idToken({ email: "kenny@example.test", sub: "1" }))).toBe("kenny@example.test");
  });

  it.each([["no token", undefined], ["no payload", "h"], ["not json", "h.bm90IGpzb24.s"], ["no email", idToken({ sub: "1" })], ["an email that is not text", idToken({ email: 5 })], ["a huge email", idToken({ email: "x".repeat(400) })]])("gives nothing for %s", (_name, value) => {
    expect(emailFromIdToken(value)).toBeUndefined();
  });

  it("is kept with the held token, and a token sealed without one still opens", () => {
    const withEmail = sealImportToken({ userId: USER, tripId: TRIP, accessToken: "ya29.read", email: "kenny@example.test", expiresInS: 3599 }, NOW);
    expect(openImportHeld(withEmail.value, USER, TRIP, NOW)).toEqual({ accessToken: "ya29.read", email: "kenny@example.test" });
    const without = sealImportToken({ userId: USER, tripId: TRIP, accessToken: "ya29.read", expiresInS: 3599 }, NOW);
    expect(openImportHeld(without.value, USER, TRIP, NOW)?.email).toBeUndefined();
  });

  it("is returned by the code exchange when Google sends an id token", async () => {
    const held = await exchangeImportCode(cfg, "code", "v", async () => new Response(JSON.stringify({ access_token: "t", expires_in: 3599, scope: IMPORT_SCOPE, id_token: idToken({ email: "kenny@example.test" }) }), { status: 200 }));
    expect(held.email).toBe("kenny@example.test");
  });
});

describe("holding the token between the consent and the import", () => {
  const held = { userId: USER, tripId: TRIP, accessToken: "ya29.read", expiresInS: 3599 };

  it("round trips for the same person and trip within ten minutes, and the cookie value hides the token", () => {
    const sealed = sealImportToken(held, NOW);
    expect(sealed.maxAgeS).toBe(IMPORT_WINDOW_MS / 1000);
    expect(sealed.value).not.toContain("ya29");
    expect(openImportToken(sealed.value, USER, TRIP, NOW + 60_000)).toBe("ya29.read");
  });

  it("lives no longer than the token itself", () => {
    expect(sealImportToken({ ...held, expiresInS: 100 }, NOW).maxAgeS).toBe(70);
    expect(sealImportToken({ ...held, expiresInS: 10 }, NOW).maxAgeS).toBe(0);
  });

  it.each([
    ["another person", USER.replace("a1", "b2"), TRIP, NOW],
    ["another trip", USER, TRIP.replace("0001", "0002"), NOW],
    ["after ten minutes", USER, TRIP, NOW + IMPORT_WINDOW_MS + 1],
  ])("is not given to %s", (_name, user, trip, now) => {
    expect(openImportToken(sealImportToken(held, NOW).value, user, trip, now)).toBeNull();
  });

  it("is not opened when it was changed, cut short or was never one", () => {
    const sealed = sealImportToken(held, NOW).value;
    expect(openImportToken(`${sealed.slice(0, -2)}AA`, USER, TRIP, NOW)).toBeNull();
    expect(openImportToken(sealed.slice(0, 10), USER, TRIP, NOW)).toBeNull();
    expect(openImportToken("not a token", USER, TRIP, NOW)).toBeNull();
    expect(openImportToken("", USER, TRIP, NOW)).toBeNull();
    expect(openImportToken(undefined, USER, TRIP, NOW)).toBeNull();
    expect(openImportToken(encryptSecret("{not json"), USER, TRIP, NOW)).toBeNull();
  });
});
