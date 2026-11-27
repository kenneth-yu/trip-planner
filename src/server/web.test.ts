import { beforeEach, describe, expect, it, vi } from "vitest";
import { loadTripPage, NOT_ON_ACCOUNT_PATH, requireUser } from "./web";
import { AccessDenied } from "@/domain/visibility/project";
import { present } from "@/testing/present";
import { USERS } from "@/fixtures/december-trip";

const state: { requestPath: string | null; user: typeof USERS.kenny | null; view: "ok" | "not-found" | "denied" } = { requestPath: null, user: null, view: "ok" };

class Redirected extends Error {
  constructor(readonly to: string) {
    super(to);
  }
}

vi.mock("next/headers", () => ({ headers: async () => new Headers(state.requestPath ? { "x-request-path": state.requestPath } : {}) }));
vi.mock("next/navigation", () => ({
  redirect: (to: string) => {
    throw new Redirected(to);
  },
}));
vi.mock("./auth/session", () => ({ currentUser: async () => state.user }));
vi.mock("./app-context", () => ({ requestContext: async () => ({}) }));
vi.mock("./services/trip-service", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./services/trip-service")>()),
  getTripView: async () => {
    if (state.view === "not-found") throw new (await import("./services/trip-service")).NotFound();
    if (state.view === "denied") throw new AccessDenied("no");
    return { view: true };
  },
}));

async function redirectTarget(run: () => Promise<unknown>): Promise<string> {
  const [outcome] = await Promise.allSettled([run()]);
  if (outcome.status !== "rejected" || !(outcome.reason instanceof Redirected)) throw new Error("Expected a redirect");
  return outcome.reason.to;
}

beforeEach(() => {
  state.requestPath = null;
  state.user = null;
  state.view = "ok";
});

describe("signed out requests", () => {
  it("carry the full path and query from the request into sign in", async () => {
    state.requestPath = "/trips/abc/inbox?day=2026-12-05";
    expect(await redirectTarget(() => requireUser("/trips/abc"))).toBe("/sign-in?next=%2Ftrips%2Fabc%2Finbox%3Fday%3D2026-12-05");
  });

  it("fall back to the path the caller gave when there is no request path", async () => {
    expect(await redirectTarget(() => loadTripPage("abc"))).toBe("/sign-in?next=%2Ftrips%2Fabc");
  });

  it("never carry an unsafe request path", async () => {
    state.requestPath = "/.//evil.com";
    expect(await redirectTarget(() => requireUser("/trips/abc"))).toBe("/sign-in?next=%2Ftrips%2Fabc");
    state.requestPath = "https://evil.com";
    expect(await redirectTarget(() => requireUser())).toBe("/sign-in");
  });
});

describe("signed in people who cannot open a trip", () => {
  it("get the same page whether the trip does not exist or they are not on it", async () => {
    state.user = USERS.kenny;
    state.view = "not-found";
    const missing = await redirectTarget(() => loadTripPage("abc"));
    state.view = "denied";
    const denied = await redirectTarget(() => loadTripPage("abc"));
    expect(missing).toBe(NOT_ON_ACCOUNT_PATH);
    expect(denied).toBe(missing);
  });

  it("see a trip they can open", async () => {
    state.user = USERS.kenny;
    expect(present(await loadTripPage("abc")).user.id).toBe(USERS.kenny.id);
  });
});
