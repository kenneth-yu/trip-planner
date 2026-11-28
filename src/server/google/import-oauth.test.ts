import { beforeAll, describe, expect, it } from "vitest";
import { IMPORT_SCOPE, MIRROR_SCOPE } from "./calendar-api";
import { exchangeImportCode, IMPORT_WINDOW_MS, ImportConsentMissing, openImportState, openImportToken, sealImportState, sealImportToken } from "./import-oauth";
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

  it("keeps the import scope away from sign in: it is only ever used with this call", () => {
    expect(IMPORT_SCOPE).toBe("https://www.googleapis.com/auth/calendar.readonly");
  });
});

describe("the state that comes back from Google", () => {
  const state = { userId: USER, tripId: TRIP, exp: NOW + IMPORT_WINDOW_MS };

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

describe("exchanging the code", () => {
  const fetchWith = (scope: string, extra: Record<string, unknown> = {}) => async () => new Response(JSON.stringify({ access_token: "ya29.read", expires_in: 3599, scope, ...extra }), { status: 200 });

  it("returns an access token and keeps nothing else, and needs no refresh token", async () => {
    const held = await exchangeImportCode(cfg, "code", fetchWith(`openid email ${IMPORT_SCOPE}`));
    expect(held).toEqual({ accessToken: "ya29.read", expiresInS: 3599 });
  });

  it("never returns a refresh token even when Google sends one", async () => {
    const held = await exchangeImportCode(cfg, "code", fetchWith(`openid ${IMPORT_SCOPE}`, { refresh_token: "1//refresh" }));
    expect(JSON.stringify(held)).not.toContain("refresh");
  });

  it("refuses a grant that does not include the read scope", async () => {
    await expect(exchangeImportCode(cfg, "code", fetchWith("openid email"))).rejects.toThrow(ImportConsentMissing);
    await expect(exchangeImportCode(cfg, "code", fetchWith(MIRROR_SCOPE))).rejects.toThrow(ImportConsentMissing);
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
  });
});
