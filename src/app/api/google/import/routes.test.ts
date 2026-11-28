import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { IMPORT_SCOPE } from "@/server/google/calendar-api";
import { IMPORT_COOKIE, openImportToken, sealImportState } from "@/server/google/import-oauth";

const TRIP = "00000000-0000-4000-8300-000000000001";
const USER = { id: "00000000-0000-4000-8000-0000000000a1", email: "kenny@example.test", homeZone: "America/New_York" };

const state = vi.hoisted(() => {
  const tokenReply: Record<string, unknown> = {};
  return {
    open: false,
    canEdit: true,
    signedIn: true,
    cookies: new Map<string, { value: string; options: Record<string, unknown> }>(),
    tokenReply,
  };
});

class Redirected extends Error {
  constructor(readonly to: string) {
    super(to);
  }
}

vi.mock("next/navigation", () => ({
  redirect: (to: string) => {
    throw new Redirected(to);
  },
}));
vi.mock("next/headers", () => ({
  cookies: async () => ({
    set: (name: string, value: string, options: Record<string, unknown>) => state.cookies.set(name, { value, options }),
  }),
}));
vi.mock("@/server/app-context", () => ({ appUrl: () => "https://trips.test" }));
vi.mock("@/server/auth/session", () => ({ currentUser: async () => (state.signedIn ? USER : null) }));
vi.mock("@/server/web", () => ({
  loadTripPage: async () => ({ user: USER, view: { permissions: { canEdit: state.canEdit } } }),
}));
vi.mock("@/server/google/import-guard", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/server/google/import-guard")>()),
  importIsRateLimited: () => state.open,
}));

import { GET as connect } from "./connect/route";
import { GET as callback } from "./callback/route";

beforeAll(() => {
  process.env.SESSION_SECRET = "test-secret-test-secret-test-secret-0123";
  process.env.TOKEN_ENCRYPTION_KEY = Buffer.alloc(32, 7).toString("base64");
  process.env.GOOGLE_CLIENT_ID = "client";
  process.env.GOOGLE_CLIENT_SECRET = "secret";
});

beforeEach(() => {
  state.open = true;
  state.canEdit = true;
  state.signedIn = true;
  state.cookies.clear();
  state.tokenReply = { access_token: "ya29.read", expires_in: 3599, scope: `openid email ${IMPORT_SCOPE}` };
  vi.stubGlobal("fetch", async () => new Response(JSON.stringify(state.tokenReply), { status: 200 }));
});

async function redirectOf(run: () => Promise<Response>): Promise<string> {
  try {
    await run();
  } catch (e) {
    if (e instanceof Redirected) return e.to;
    throw e;
  }
  throw new Error("expected a redirect");
}

const validState = () => sealImportState({ userId: USER.id, tripId: TRIP, exp: Date.now() + 60_000 });
const callbackRequest = (query: string) => new Request(`https://trips.test/api/google/import/callback?${query}`);

describe("the import consent route", () => {
  it("is closed until a rate rule covers it", async () => {
    state.open = false;
    const response = await connect(new Request(`https://trips.test/api/google/import/connect?trip=${TRIP}`));
    expect(response.status).toBe(503);
    expect(await response.text()).toBe("Google Calendar import is not open yet.");
  });

  it("refuses a missing or malformed trip", async () => {
    expect((await connect(new Request("https://trips.test/api/google/import/connect"))).status).toBe(400);
    expect((await connect(new Request("https://trips.test/api/google/import/connect?trip=../../x"))).status).toBe(400);
  });

  it("refuses a person who cannot edit the trip, before Google is asked anything", async () => {
    state.canEdit = false;
    const response = await connect(new Request(`https://trips.test/api/google/import/connect?trip=${TRIP}`));
    expect(response.status).toBe(403);
  });

  it("sends an editor to Google for the read scope only, online, with a signed state", async () => {
    const to = new URL(await redirectOf(() => connect(new Request(`https://trips.test/api/google/import/connect?trip=${TRIP}`))));
    expect(to.origin + to.pathname).toBe("https://accounts.google.com/o/oauth2/v2/auth");
    expect(to.searchParams.get("scope")).toBe(`openid email ${IMPORT_SCOPE}`);
    expect(to.searchParams.get("access_type")).toBe("online");
    expect(to.searchParams.get("redirect_uri")).toBe("https://trips.test/api/google/import/callback");
    expect(to.searchParams.get("state")).toMatch(/\./);
  });
});

describe("the import callback route", () => {
  it("is closed until a rate rule covers it", async () => {
    state.open = false;
    expect((await callback(callbackRequest(`code=c&state=${validState()}`))).status).toBe(503);
    expect(state.cookies.size).toBe(0);
  });

  it("refuses a state that is missing, forged or for another person", async () => {
    expect((await callback(callbackRequest("code=c"))).status).toBe(400);
    expect((await callback(callbackRequest("code=c&state=abc.def"))).status).toBe(400);
    const other = sealImportState({ userId: "someone-else", tripId: TRIP, exp: Date.now() + 60_000 });
    expect((await callback(callbackRequest(`code=c&state=${other}`))).status).toBe(400);
    expect(state.cookies.size).toBe(0);
  });

  it("holds the read token in a short, sealed cookie scoped to the import page, and sends the person there", async () => {
    const to = await redirectOf(() => callback(callbackRequest(`code=c&state=${validState()}`)));
    expect(to).toBe(`/trips/${TRIP}/import/google`);
    const cookie = state.cookies.get(IMPORT_COOKIE);
    expect(cookie?.options).toMatchObject({ httpOnly: true, sameSite: "lax", path: `/trips/${TRIP}/import/google` });
    expect(Number(cookie?.options.maxAge)).toBeLessThanOrEqual(600);
    expect(cookie?.value).not.toContain("ya29");
    expect(openImportToken(cookie?.value, USER.id, TRIP)).toBe("ya29.read");
  });

  it("stores no Google connection and no refresh token: the only thing kept is the cookie", async () => {
    state.tokenReply = { ...state.tokenReply, refresh_token: "1//refresh" };
    await redirectOf(() => callback(callbackRequest(`code=c&state=${validState()}`)));
    expect(JSON.stringify([...state.cookies.values()])).not.toContain("1//refresh");
  });

  it("says so when the person declined, and sets no cookie", async () => {
    expect(await redirectOf(() => callback(callbackRequest(`error=access_denied&state=${validState()}`)))).toBe(`/trips/${TRIP}/import/google?consent=declined`);
    expect(state.cookies.size).toBe(0);
  });

  it("says so when Google granted something other than the read scope, and sets no cookie", async () => {
    state.tokenReply = { ...state.tokenReply, scope: "openid email" };
    expect(await redirectOf(() => callback(callbackRequest(`code=c&state=${validState()}`)))).toBe(`/trips/${TRIP}/import/google?consent=declined`);
    expect(state.cookies.size).toBe(0);
  });

  it("sends a signed out person away without touching Google", async () => {
    state.signedIn = false;
    expect(await redirectOf(() => callback(callbackRequest(`code=c&state=${validState()}`)))).toBe("/");
  });
});
