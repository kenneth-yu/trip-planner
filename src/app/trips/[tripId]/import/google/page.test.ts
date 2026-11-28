import { renderToStaticMarkup } from "react-dom/server";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { TRIP_ID, USERS } from "@/fixtures/december-trip";
import { FakeGoogleCalendar, GoogleApiError, GoogleAuthorizationError } from "@/server/google/calendar-api";
import { sealImportToken } from "@/server/google/import-oauth";
import { kenny, testContext } from "@/server/testing";
import { getTripView } from "@/server/services/trip-service";
import type { ServiceContext } from "@/server/services/context";
import GoogleImportPage from "./page";

class NotFound extends Error {}

const world = vi.hoisted(() => {
  const holder: { ctx: ServiceContext | null; canEdit: boolean; open: boolean; configured: boolean; cookie: string | undefined; google: unknown; items: boolean } = {
    ctx: null,
    canEdit: true,
    open: true,
    configured: true,
    cookie: undefined,
    google: null,
    items: true,
  };
  return { holder };
});

vi.mock("next/headers", () => ({ cookies: async () => ({ get: (name: string) => (name === "google_import" && world.holder.cookie ? { name, value: world.holder.cookie } : undefined) }) }));
vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new NotFound("not found");
  },
}));
vi.mock("@/server/app-context", () => ({ appUrl: () => "https://trips.test" }));
vi.mock("@/server/web", () => ({
  loadTripPage: async () => {
    if (!world.holder.ctx) throw new Error("no test context");
    const view = await getTripView(world.holder.ctx, TRIP_ID, kenny);
    return { ctx: world.holder.ctx, user: { id: USERS.kenny.id }, view: { ...view, items: world.holder.items ? view.items : [], permissions: { ...view.permissions, canEdit: world.holder.canEdit } } };
  },
}));
vi.mock("@/server/google/import-guard", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/server/google/import-guard")>()),
  importIsRateLimited: () => world.holder.open,
  importOAuthConfig: () => (world.holder.configured ? { clientId: "c", clientSecret: "s", redirectUri: "https://trips.test/api/google/import/callback" } : null),
  importReader: async () => {
    if (world.holder.google instanceof Error) throw world.holder.google;
    return world.holder.google;
  },
}));

beforeAll(() => {
  process.env.SESSION_SECRET = "test-secret-test-secret-test-secret-0123";
  process.env.TOKEN_ENCRYPTION_KEY = Buffer.alloc(32, 7).toString("base64");
});

beforeEach(async () => {
  world.holder.ctx = (await testContext({ withItems: true })).ctx;
  world.holder.canEdit = true;
  world.holder.open = true;
  world.holder.configured = true;
  world.holder.google = null;
  world.holder.items = true;
  world.holder.cookie = undefined;
});

const withToken = () => {
  world.holder.cookie = sealImportToken({ userId: USERS.kenny.id, tripId: TRIP_ID, accessToken: "ya29.read", expiresInS: 3599 }).value;
};

async function render(consent?: string) {
  const element = await GoogleImportPage({ params: Promise.resolve({ tripId: TRIP_ID }), searchParams: Promise.resolve(consent ? { consent } : {}) });
  return renderToStaticMarkup(element);
}

describe("the Google import page", () => {
  it("is not there at all when Google is not configured", async () => {
    world.holder.configured = false;
    await expect(render()).rejects.toThrow(NotFound);
  });

  it("is not there for someone who cannot edit the trip", async () => {
    world.holder.canEdit = false;
    await expect(render()).rejects.toThrow(NotFound);
  });

  it("offers to connect, and says nothing is kept, before anything is connected", async () => {
    const html = await render();
    expect(html).toContain(`href="/api/google/import/connect?trip=${TRIP_ID}"`);
    expect(html).not.toContain('role="alert"');
  });

  it.each([
    ["declined", "Google calendar access was not granted."],
    ["expired", "That Google sign in expired or was already used. Connect again."],
    ["failed", "Google sign in did not finish. Try again."],
  ])("shows an alert for %s and still offers to connect", async (consent, message) => {
    const html = await render(consent);
    expect(html).toContain(`<p role="alert">${message}</p>`);
    expect(html).toContain(`href="/api/google/import/connect?trip=${TRIP_ID}"`);
  });

  it("ignores a consent value it does not know", async () => {
    expect(await render("<script>")).not.toContain('role="alert"');
  });

  it("lists the calendars, the primary one first, with the trip's dates a day either side already filled in", async () => {
    withToken();
    const google = new FakeGoogleCalendar();
    google.seedCalendar("Zed", []);
    google.seedCalendar("Mine", [], { primary: true });
    world.holder.google = google;
    const html = await render();
    expect(html.indexOf("Mine")).toBeGreaterThan(-1);
    expect(html.indexOf("Mine")).toBeLessThan(html.indexOf("Zed"));
    expect(html).toContain('name="from" value="2026-11-30"');
    expect(html).toContain('name="to" value="2026-12-17"');
  });

  it("fills in today and the next 60 days when the trip has nothing on it yet", async () => {
    withToken();
    world.holder.items = false;
    const google = new FakeGoogleCalendar();
    google.seedCalendar("Mine", [], { primary: true });
    world.holder.google = google;
    const html = await render();
    const today = Date.parse(`${world.holder.ctx?.now().toISOString().slice(0, 10)}T00:00:00Z`);
    expect(html).toContain(`name="from" value="${new Date(today).toISOString().slice(0, 10)}"`);
    expect(html).toContain(`name="to" value="${new Date(today + 60 * 86_400_000).toISOString().slice(0, 10)}"`);
  });

  it("shows an alert the editor can retry from, never an error page, when Google fails or does not answer", async () => {
    withToken();
    world.holder.google = new GoogleApiError(503, "Google Calendar GET could not be reached: TimeoutError");
    const html = await render();
    expect(html).toContain('<p role="alert">Google did not answer. Try again in a minute.</p>');
    expect(html).toContain(`href="/trips/${TRIP_ID}/import/google"`);
  });

  it("goes back to connecting when Google refuses the token", async () => {
    withToken();
    world.holder.google = new GoogleAuthorizationError(401, "Google Calendar GET failed: 401");
    expect(await render()).toContain(`href="/api/google/import/connect?trip=${TRIP_ID}"`);
  });

  it("says it is not open yet while no rate rule covers it", async () => {
    world.holder.open = false;
    expect(await render()).toContain("Google Calendar import is not open yet.");
  });

  it("does not read the token cookie of another trip", async () => {
    world.holder.cookie = sealImportToken({ userId: USERS.kenny.id, tripId: "00000000-0000-4000-8300-0000000000ff", accessToken: "ya29.read", expiresInS: 3599 }).value;
    expect(await render()).toContain("Connect Google Calendar");
  });
});
