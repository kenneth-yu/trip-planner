import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { fixture, TRIP_ID, USERS } from "@/fixtures/december-trip";
import type { CalendarEvent } from "@/domain/import/calendar-event";
import { FakeGoogleCalendar, GoogleApiError, GoogleAuthorizationError } from "@/server/google/calendar-api";
import { IMPORT_COOKIE, sealImportToken } from "@/server/google/import-oauth";
import { kenny, testContext } from "@/server/testing";
import { listInbox } from "@/server/services/inbox-service";
import type { ServiceContext } from "@/server/services/context";
import { runGoogleImport } from "./actions";

class Redirected extends Error {
  constructor(readonly to: string) {
    super(to);
  }
}

const world = vi.hoisted(() => {
  const jar = new Map<string, string>();
  const deleted: { name: string; path?: string }[] = [];
  const holder: { ctx: ServiceContext | null; open: boolean; google: unknown } = { ctx: null, open: true, google: null };
  return { jar, deleted, holder };
});

vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) => (world.jar.has(name) ? { name, value: world.jar.get(name) } : undefined),
    delete: (target: { name: string; path?: string }) => {
      world.deleted.push(target);
      world.jar.delete(target.name);
    },
  }),
}));
vi.mock("next/navigation", () => ({
  redirect: (to: string) => {
    throw new Redirected(to);
  },
}));
vi.mock("next/cache", () => ({ revalidatePath: () => undefined }));
vi.mock("@/server/web", () => ({
  loadTripPage: async () => {
    if (!world.holder.ctx) throw new Error("no test context");
    return { ctx: world.holder.ctx, user: { id: USERS.kenny.id }, requester: kenny };
  },
}));
vi.mock("@/server/google/import-guard", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/server/google/import-guard")>()),
  importIsRateLimited: () => world.holder.open,
}));
vi.mock("@/server/google/calendar-api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/server/google/calendar-api")>()),
  googleCalendarReader: () => world.holder.google,
}));

const events: CalendarEvent[] = fixture.calendarEvents;
const PAGE = `/trips/${TRIP_ID}/import/google`;

function form(values: { calendars?: string[]; from?: string; to?: string; tripId?: string }) {
  const f = new FormData();
  f.set("tripId", values.tripId ?? TRIP_ID);
  f.set("from", values.from ?? "2026-11-30");
  f.set("to", values.to ?? "2026-12-16");
  for (const id of values.calendars ?? []) f.append("calendar", id);
  return f;
}

const idle = { message: null, error: false };

beforeAll(() => {
  process.env.SESSION_SECRET = "test-secret-test-secret-test-secret-0123";
  process.env.TOKEN_ENCRYPTION_KEY = Buffer.alloc(32, 7).toString("base64");
});

async function startWith(opts: { token?: boolean; tripId?: string } = {}) {
  const env = await testContext({ withItems: false });
  world.holder.ctx = env.ctx;
  const google = new FakeGoogleCalendar();
  const calendar = google.seedCalendar("kenny primary", events.filter((e) => e.calendar === "kenny primary"));
  world.holder.google = google;
  if (opts.token !== false) world.jar.set(IMPORT_COOKIE, sealImportToken({ userId: USERS.kenny.id, tripId: opts.tripId ?? TRIP_ID, accessToken: "ya29.read", expiresInS: 3599 }).value);
  return { ...env, google, calendar };
}

beforeEach(() => {
  world.jar.clear();
  world.deleted.length = 0;
  world.holder.open = true;
  world.holder.ctx = null;
  world.holder.google = null;
});

async function result(run: Promise<unknown>) {
  try {
    return { returned: await run, redirectedTo: null };
  } catch (e) {
    if (e instanceof Redirected) return { returned: null, redirectedTo: e.to };
    throw e;
  }
}

describe("running the Google import", () => {
  it("is closed until a rate rule covers it, and does not even look at the cookie", async () => {
    const { calendar } = await startWith();
    world.holder.open = false;
    expect(await runGoogleImport(idle, form({ calendars: [calendar] }))).toEqual({ message: "Google Calendar import is not open yet.", error: true });
    expect(world.jar.has(IMPORT_COOKIE)).toBe(true);
  });

  it("asks to connect again when there is no token", async () => {
    const { calendar } = await startWith({ token: false });
    expect(await runGoogleImport(idle, form({ calendars: [calendar] }))).toEqual({ message: "Connect Google Calendar again to import.", error: true });
  });

  it("does not use a token that was held for another trip", async () => {
    const { calendar } = await startWith({ tripId: "00000000-0000-4000-8300-0000000000ff" });
    expect(await runGoogleImport(idle, form({ calendars: [calendar] }))).toMatchObject({ error: true });
  });

  it("imports into the inbox, uses the token once, clears it and goes to the inbox", async () => {
    const { ctx, calendar } = await startWith();
    const outcome = await result(runGoogleImport(idle, form({ calendars: [calendar] })));
    expect(outcome.redirectedTo).toBe(`/trips/${TRIP_ID}/inbox`);
    expect(world.deleted).toEqual([{ name: IMPORT_COOKIE, path: PAGE }]);
    expect((await listInbox(ctx, TRIP_ID, kenny)).length).toBeGreaterThan(0);
  });

  it("keeps the token when the form was wrong, so the person can fix it", async () => {
    const { ctx } = await startWith();
    expect(await runGoogleImport(idle, form({ calendars: [] }))).toEqual({ message: "Choose at least one calendar.", error: true });
    expect(world.jar.has(IMPORT_COOKIE)).toBe(true);
    expect(await listInbox(ctx, TRIP_ID, kenny)).toEqual([]);
  });

  it("clears the token and says to connect again when Google refuses it", async () => {
    const { google, calendar } = await startWith();
    google.failNext = new GoogleAuthorizationError(401, "Google Calendar GET failed: 401");
    expect(await runGoogleImport(idle, form({ calendars: [calendar] }))).toEqual({ message: "Google did not allow that. Connect Google Calendar again.", error: true });
    expect(world.deleted).toEqual([{ name: IMPORT_COOKIE, path: PAGE }]);
  });

  it("keeps the token and says to try again when Google fails or does not answer, so the editor can retry", async () => {
    const { google, calendar, ctx } = await startWith();
    google.failNext = new GoogleApiError(503, "Google Calendar GET could not be reached: TimeoutError");
    expect(await runGoogleImport(idle, form({ calendars: [calendar] }))).toEqual({ message: "Google did not answer. Try again in a minute.", error: true });
    expect(world.deleted).toEqual([]);
    expect(world.jar.has(IMPORT_COOKIE)).toBe(true);
    expect(await listInbox(ctx, TRIP_ID, kenny)).toEqual([]);
  });

  it("says plainly when the range holds more than 500 events and keeps the token", async () => {
    const { calendar, google } = await startWith();
    const many = Array.from({ length: 501 }, (_, i) => ({ id: `e${i}`, summary: `Event ${i}`, start: { date: "2026-12-02" }, end: { date: "2026-12-03" } }));
    google.readable.set(calendar, { summary: "kenny primary", events: many, primary: true });
    expect(await runGoogleImport(idle, form({ calendars: [calendar] }))).toEqual({ message: "That range has more than 500 events. Choose fewer calendars or a shorter range.", error: true });
    expect(world.jar.has(IMPORT_COOKIE)).toBe(true);
  });

  it("clears the token and says nothing was found when the range holds no events", async () => {
    const { calendar } = await startWith();
    const outcome = await result(runGoogleImport(idle, form({ calendars: [calendar], from: "2027-03-01", to: "2027-03-05" })));
    expect(outcome.returned).toEqual({ message: "Nothing in those calendars for those dates.", error: false });
    expect(world.deleted).toEqual([{ name: IMPORT_COOKIE, path: PAGE }]);
  });

  it("rejects a trip id that is not an id", async () => {
    await startWith();
    await expect(runGoogleImport(idle, form({ tripId: "../x" }))).rejects.toThrow();
  });
});
