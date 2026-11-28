import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { IMPORT_SCOPE } from "@/server/google/calendar-api";
import { IMPORT_COOKIE, IMPORT_FLOW_COOKIE, IMPORT_FLOW_PATH, IMPORT_SEEN_COOKIE, openImportToken, startImportFlow } from "@/server/google/import-oauth";

const TRIP = "00000000-0000-4000-8300-000000000001";
const USER = { id: "00000000-0000-4000-8000-0000000000a1", email: "kenny@example.test", homeZone: "America/New_York" };

const state = vi.hoisted(() => {
  const tokenReply: Record<string, unknown> = {};
  const deleted: { name: string; path?: string }[] = [];
  const bodies: string[] = [];
  return {
    open: false,
    canEdit: true,
    signedIn: true,
    cookies: new Map<string, { value: string; options: Record<string, unknown> }>(),
    deleted,
    tokenReply,
    bodies,
    tokenStatus: 200,
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
    get: (name: string) => (state.cookies.has(name) ? { name, value: state.cookies.get(name)?.value } : undefined),
    delete: (target: { name: string; path?: string }) => {
      state.deleted.push(target);
      state.cookies.delete(target.name);
    },
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
  state.deleted.length = 0;
  state.bodies.length = 0;
  state.tokenStatus = 200;
  state.tokenReply = { access_token: "ya29.read", expires_in: 3599, scope: `openid email ${IMPORT_SCOPE}` };
  vi.stubGlobal("fetch", async (_url: string, init?: { body?: URLSearchParams }) => {
    state.bodies.push(String(init?.body ?? ""));
    return new Response(state.tokenStatus === 200 ? JSON.stringify(state.tokenReply) : "invalid_grant", { status: state.tokenStatus });
  });
});

async function redirectOf(run: () => Promise<unknown>): Promise<string> {
  try {
    await run();
  } catch (e) {
    if (e instanceof Redirected) return e.to;
    throw e;
  }
  throw new Error("expected a redirect");
}

function started() {
  const flow = startImportFlow(USER.id, TRIP);
  state.cookies.set(IMPORT_FLOW_COOKIE, { value: flow.cookie.value, options: {} });
  return flow;
}
const validState = () => started().state;
const callbackRequest = (query: string) => new Request(`https://trips.test/api/google/import/callback?${query}`);

describe("the import consent route", () => {
  const connectRequest = () => new Request(`https://trips.test/api/google/import/connect?trip=${TRIP}`);

  it("is closed until a rate rule covers it", async () => {
    state.open = false;
    const response = await connect(connectRequest());
    expect(response.status).toBe(503);
    expect(await response.text()).toBe("Google Calendar import is not open yet.");
  });

  it("is not found when Google is not configured on this server", async () => {
    delete process.env.GOOGLE_CLIENT_ID;
    expect((await connect(connectRequest())).status).toBe(404);
    process.env.GOOGLE_CLIENT_ID = "client";
  });

  it("refuses a missing or malformed trip", async () => {
    expect((await connect(new Request("https://trips.test/api/google/import/connect"))).status).toBe(400);
    expect((await connect(new Request("https://trips.test/api/google/import/connect?trip=../../x"))).status).toBe(400);
  });

  it("refuses a person who cannot edit the trip, before Google is asked anything", async () => {
    state.canEdit = false;
    expect((await connect(connectRequest())).status).toBe(403);
    expect(state.cookies.size).toBe(0);
  });

  it("sends an editor to Google for the read scope only, online, with a signed state and a PKCE challenge", async () => {
    const to = new URL(await redirectOf(() => connect(connectRequest())));
    expect(to.origin + to.pathname).toBe("https://accounts.google.com/o/oauth2/v2/auth");
    expect(to.searchParams.get("scope")).toBe(`openid email ${IMPORT_SCOPE}`);
    expect(to.searchParams.get("access_type")).toBe("online");
    expect(to.searchParams.get("redirect_uri")).toBe("https://trips.test/api/google/import/callback");
    expect(to.searchParams.get("state")).toMatch(/\./);
    expect(to.searchParams.get("code_challenge_method")).toBe("S256");
    expect(to.searchParams.get("code_challenge")).toMatch(/^[A-Za-z0-9_-]{43}$/);
  });

  it("clears the marker of an earlier connection when a person starts again", async () => {
    state.cookies.set(IMPORT_SEEN_COOKIE, { value: "1", options: {} });
    await redirectOf(() => connect(connectRequest()));
    expect(state.deleted).toEqual([{ name: IMPORT_SEEN_COOKIE, path: `/trips/${TRIP}/import/google` }]);
  });

  it("holds the PKCE verifier and the state nonce only in a sealed cookie, never in the redirect", async () => {
    const to = await redirectOf(() => connect(connectRequest()));
    const cookie = state.cookies.get(IMPORT_FLOW_COOKIE);
    expect(cookie?.options).toMatchObject({ httpOnly: true, sameSite: "lax", path: IMPORT_FLOW_PATH, maxAge: 600 });
    expect(to).not.toContain(cookie?.value ?? "missing");
    expect(Buffer.from(new URL(to).searchParams.get("state")?.split(".")[0] ?? "", "base64url").toString("utf8")).toContain("nonce");
  });
});

describe("the import callback route", () => {
  const page = `/trips/${TRIP}/import/google`;

  it("sends a person home, never to an error page, when the import is closed", async () => {
    state.open = false;
    expect(await redirectOf(() => callback(callbackRequest(`code=c&state=${validState()}`)))).toBe("/");
    expect(state.cookies.has(IMPORT_COOKIE)).toBe(false);
  });

  it("sends a person home, never to an error page, for a state that is missing, forged or for another person", async () => {
    started();
    expect(await redirectOf(() => callback(callbackRequest("code=c")))).toBe("/");
    expect(await redirectOf(() => callback(callbackRequest("code=c&state=abc.def")))).toBe("/");
    const other = startImportFlow("someone-else", TRIP).state;
    expect(await redirectOf(() => callback(callbackRequest(`code=c&state=${other}`)))).toBe("/");
    expect(state.cookies.has(IMPORT_COOKIE)).toBe(false);
  });

  it("holds the read token in a short, sealed cookie scoped to the import page, and sends the person there", async () => {
    const to = await redirectOf(() => callback(callbackRequest(`code=c&state=${validState()}`)));
    expect(to).toBe(page);
    const cookie = state.cookies.get(IMPORT_COOKIE);
    expect(cookie?.options).toMatchObject({ httpOnly: true, sameSite: "lax", path: page });
    expect(Number(cookie?.options.maxAge)).toBeLessThanOrEqual(600);
    expect(cookie?.value).not.toContain("ya29");
    expect(openImportToken(cookie?.value, USER.id, TRIP)).toBe("ya29.read");
  });

  it("leaves a plain marker that this person connected, for as long as an hour, so the page can say the permission ran out", async () => {
    await redirectOf(() => callback(callbackRequest(`code=c&state=${validState()}`)));
    const marker = state.cookies.get(IMPORT_SEEN_COOKIE);
    expect(marker?.value).toBe("1");
    expect(marker?.options).toMatchObject({ httpOnly: true, sameSite: "lax", path: page, maxAge: 3600 });
  });

  it("leaves no marker when the person did not connect", async () => {
    await redirectOf(() => callback(callbackRequest(`error=access_denied&state=${validState()}`)));
    expect(state.cookies.has(IMPORT_SEEN_COOKIE)).toBe(false);
  });

  it("sends the PKCE verifier to Google and clears the flow cookie, so the same callback cannot be used twice", async () => {
    const flow = started();
    await redirectOf(() => callback(callbackRequest(`code=c&state=${flow.state}`)));
    expect(new URLSearchParams(state.bodies[0]).get("code_verifier")).toMatch(/^[A-Za-z0-9_-]{64}$/);
    expect(state.deleted).toEqual([{ name: IMPORT_FLOW_COOKIE, path: IMPORT_FLOW_PATH }]);
    expect(await redirectOf(() => callback(callbackRequest(`code=c&state=${flow.state}`)))).toBe(`${page}?consent=failed`);
    expect(state.bodies).toHaveLength(1);
  });

  it("refuses a state whose nonce does not match the browser's flow cookie", async () => {
    const mine = startImportFlow(USER.id, TRIP);
    const theirs = startImportFlow(USER.id, TRIP);
    state.cookies.set(IMPORT_FLOW_COOKIE, { value: mine.cookie.value, options: {} });
    expect(await redirectOf(() => callback(callbackRequest(`code=c&state=${theirs.state}`)))).toBe(`${page}?consent=failed`);
    expect(state.bodies).toEqual([]);
    expect(state.cookies.has(IMPORT_COOKIE)).toBe(false);
  });

  it("refuses a callback that arrives with no flow cookie at all", async () => {
    const flow = startImportFlow(USER.id, TRIP);
    expect(await redirectOf(() => callback(callbackRequest(`code=c&state=${flow.state}`)))).toBe(`${page}?consent=failed`);
    expect(state.bodies).toEqual([]);
  });

  it("stores no Google connection and no refresh token: the only thing kept is the cookie", async () => {
    state.tokenReply = { ...state.tokenReply, refresh_token: "1//refresh" };
    await redirectOf(() => callback(callbackRequest(`code=c&state=${validState()}`)));
    expect(JSON.stringify([...state.cookies.values()])).not.toContain("1//refresh");
  });

  it("says so when the person declined, and sets no token cookie", async () => {
    expect(await redirectOf(() => callback(callbackRequest(`error=access_denied&state=${validState()}`)))).toBe(`${page}?consent=declined`);
    expect(state.cookies.has(IMPORT_COOKIE)).toBe(false);
  });

  it("says so when Google granted something other than the read scope, and sets no token cookie", async () => {
    state.tokenReply = { ...state.tokenReply, scope: "openid email" };
    expect(await redirectOf(() => callback(callbackRequest(`code=c&state=${validState()}`)))).toBe(`${page}?consent=declined`);
    expect(state.cookies.has(IMPORT_COOKIE)).toBe(false);
  });

  it("shows a friendly page when the code was already used or has expired", async () => {
    state.tokenStatus = 400;
    expect(await redirectOf(() => callback(callbackRequest(`code=c&state=${validState()}`)))).toBe(`${page}?consent=expired`);
    expect(state.cookies.has(IMPORT_COOKIE)).toBe(false);
  });

  it("lands on a page the editor can retry from when Google fails or cannot be reached", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    state.tokenStatus = 503;
    expect(await redirectOf(() => callback(callbackRequest(`code=c&state=${validState()}`)))).toBe(`${page}?consent=failed`);
    vi.stubGlobal("fetch", async () => {
      throw new TypeError("fetch failed");
    });
    expect(await redirectOf(() => callback(callbackRequest(`code=c&state=${validState()}`)))).toBe(`${page}?consent=failed`);
  });

  it("sends a signed out person away without touching Google", async () => {
    state.signedIn = false;
    expect(await redirectOf(() => callback(callbackRequest(`code=c&state=${validState()}`)))).toBe("/");
    expect(state.bodies).toEqual([]);
  });
});
