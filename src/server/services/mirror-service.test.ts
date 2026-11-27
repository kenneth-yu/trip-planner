import { present } from "@/testing/present";
import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { TRIP_ID, USERS } from "@/fixtures/december-trip";
import * as t from "../db/schema";
import { FakeGoogleCalendar, GoogleApiError } from "../google/calendar-api";
import { jacob, kenny, testContext } from "../testing";
import { disableMirror, enableMirror, mirrorState, syncMirror, syncTripMirrors } from "./mirror-service";
import { getTripView, quickAddItem, removeItem, updateItem } from "./trip-service";
import { approveEntry, importCalendarEvents, listInbox } from "./inbox-service";
import { fixture } from "@/fixtures/december-trip";
import type { CalendarEvent } from "@/domain/import/calendar-event";
import { fromLocal } from "@/domain/time/format";

const fixtureEvents: CalendarEvent[] = fixture.calendarEvents;

async function setup() {
  const google = new FakeGoogleCalendar();
  const env = await testContext({ overrides: { googleFor: async () => google } });
  env.ctx.onTripChanged = async (tripId) => {
    await syncTripMirrors(env.ctx, tripId);
  };
  return { ...env, google };
}

async function failOneSync(ctx: Awaited<ReturnType<typeof setup>>["ctx"], google: FakeGoogleCalendar) {
  const cx509 = present((await getTripView(ctx, TRIP_ID, kenny)).items.find((i) => i.flight?.flightNumber === "CX509"));
  google.failNext = new GoogleApiError(503, "Backend Error");
  await updateItem(ctx, TRIP_ID, cx509.id, kenny, { notes: "Window seats" });
}

describe("Google Calendar mirror", () => {
  it("creates one dedicated calendar with every item, then does nothing when nothing changed", async () => {
    const { ctx, google } = await setup();
    const first = await enableMirror(ctx, TRIP_ID, USERS.kenny.id);
    expect(google.calendars.size).toBe(1);
    expect([...google.calendars.values()][0].summary).toBe("Asia, December 2026 (Trip planner)");
    expect(first.created).toBe(13);
    const again = await syncMirror(ctx, TRIP_ID, USERS.kenny.id);
    expect(again).toMatchObject({ created: 0, updated: 0, deleted: 0 });
  });

  it("follows the app: edits, deletions and approved inbox items flow to Google on their own", async () => {
    const { ctx, google } = await setup();
    await enableMirror(ctx, TRIP_ID, USERS.kenny.id);
    google.calls = [];
    const view = await getTripView(ctx, TRIP_ID, kenny);
    const cx509 = present(view.items.find((i) => i.flight?.flightNumber === "CX509"));
    await updateItem(ctx, TRIP_ID, cx509.id, kenny, { start: fromLocal("2026-12-05T09:00", "Asia/Tokyo") });
    const total = present(view.items.find((i) => i.title.startsWith("Stay at Total")));
    await removeItem(ctx, TRIP_ID, total.id, kenny);
    await importCalendarEvents(ctx, TRIP_ID, jacob, [{ summary: "Dim sum, Tim Ho Wan", location: "Tim Ho Wan, 9-11 Fuk Wing Street, Sham Shui Po, Hong Kong", start: { dateTime: "2026-12-11T11:00:00+08:00" }, end: { dateTime: "2026-12-11T12:30:00+08:00" } }], { source: "assistant", label: "Jacob's Claude" });
    expect(google.calls).toEqual(["update CX509 Tokyo to Hong Kong", expect.stringMatching(/^delete /)]);
    const [entry] = await listInbox(ctx, TRIP_ID, kenny);
    await approveEntry(ctx, TRIP_ID, entry.id, kenny);
    expect(google.calls.at(-1)).toBe("insert Dim sum, Tim Ho Wan");
    const dimSum = present(google.allEvents().find((e) => e.summary === "Dim sum, Tim Ho Wan"));
    expect(dimSum.start).toEqual({ dateTime: "2026-12-11T11:00:00+08:00", timeZone: "Asia/Hong_Kong" });
  });

  it("each member's calendar only holds what they can see", async () => {
    const { ctx, google } = await setup();
    await quickAddItem(ctx, TRIP_ID, jacob, { type: "plan", title: "Ring shopping", city: "Hong Kong", startLocal: "2026-12-05T20:00", endLocal: "2026-12-05T21:00" }, { visibility: "only_me", showAsBusy: true });
    await enableMirror(ctx, TRIP_ID, USERS.kenny.id);
    const kennyCal = [...google.calendars.values()][0];
    const summaries = [...kennyCal.events.values()].map((e) => e.summary);
    expect(summaries).toContain("Busy");
    expect(JSON.stringify([...kennyCal.events.values()])).not.toMatch(/Ring|PLACEHOLDER|30K/);
  });

  it("puts back an event someone deleted in Google, because the app is the source of truth", async () => {
    const { ctx, google } = await setup();
    await enableMirror(ctx, TRIP_ID, USERS.kenny.id);
    const cal = [...google.calendars.values()][0];
    const [eventId, event] = present([...cal.events.entries()].find(([, e]) => e.summary.startsWith("CX509")));
    cal.events.delete(eventId);
    const cx509 = present((await getTripView(ctx, TRIP_ID, kenny)).items.find((i) => i.flight?.flightNumber === "CX509"));
    await updateItem(ctx, TRIP_ID, cx509.id, kenny, { notes: "Gate closes 40 min before" });
    expect([...cal.events.values()].filter((e) => e.summary === event.summary)).toHaveLength(1);
  });

  it("records a Google failure on the mirror and recovers on the next sync without duplicates", async () => {
    const { ctx, db, google } = await setup();
    await enableMirror(ctx, TRIP_ID, USERS.kenny.id);
    const cx509 = present((await getTripView(ctx, TRIP_ID, kenny)).items.find((i) => i.flight?.flightNumber === "CX509"));
    google.failNext = new GoogleApiError(503, "Backend Error");
    await updateItem(ctx, TRIP_ID, cx509.id, kenny, { notes: "Window seats" });
    const [failed] = await db.select().from(t.calendarMirrors).where(eq(t.calendarMirrors.userId, USERS.kenny.id));
    expect(failed.lastError).toBe("Backend Error");
    const outcome = await syncTripMirrors(ctx, TRIP_ID);
    expect(outcome).toEqual([{ userId: USERS.kenny.id, status: "synced", result: expect.objectContaining({ updated: 1, created: 0 }) }]);
    expect(google.allEvents()).toHaveLength(13);
  });

  it("removes the trip from the calendar of someone who left it", async () => {
    const { ctx, db, google } = await setup();
    await enableMirror(ctx, TRIP_ID, USERS.jacob.id);
    expect(google.allEvents()).toHaveLength(13);
    await db.delete(t.memberships).where(eq(t.memberships.userId, USERS.jacob.id));
    await syncMirror(ctx, TRIP_ID, USERS.jacob.id);
    expect(google.allEvents()).toHaveLength(0);
    const [mirror] = await db.select().from(t.calendarMirrors).where(eq(t.calendarMirrors.userId, USERS.jacob.id));
    expect(mirror.enabled).toBe(false);
  });

  it("stops following the trip when turned off", async () => {
    const { ctx, google } = await setup();
    await enableMirror(ctx, TRIP_ID, USERS.kenny.id);
    await disableMirror(ctx, TRIP_ID, USERS.kenny.id);
    google.calls = [];
    const item = (await getTripView(ctx, TRIP_ID, kenny)).items[0];
    await updateItem(ctx, TRIP_ID, item.id, kenny, { notes: "x" });
    expect(google.calls).toEqual([]);
  });

  it("derives the state from the row: connecting, in sync, failed, off", async () => {
    const { ctx, db, google } = await setup();
    const row = async () => present((await db.select().from(t.calendarMirrors).where(eq(t.calendarMirrors.userId, USERS.kenny.id)))[0]);
    await enableMirror(ctx, TRIP_ID, USERS.kenny.id);
    expect(mirrorState(await row())).toBe("InSync");
    await failOneSync(ctx, google);
    expect(mirrorState(await row())).toBe("Failed");
    await syncMirror(ctx, TRIP_ID, USERS.kenny.id);
    expect(mirrorState(await row())).toBe("InSync");
    await disableMirror(ctx, TRIP_ID, USERS.kenny.id);
    expect(mirrorState(await row())).toBe("Off");
    expect(mirrorState({ enabled: true, lastError: null, lastSyncedAt: null })).toBe("Connecting");
  });

  it("a failed mirror can resume after being stopped and started again", async () => {
    const { ctx, google } = await setup();
    await enableMirror(ctx, TRIP_ID, USERS.kenny.id);
    await failOneSync(ctx, google);
    await disableMirror(ctx, TRIP_ID, USERS.kenny.id);
    await enableMirror(ctx, TRIP_ID, USERS.kenny.id);
    expect(google.allEvents()).toHaveLength(13);
  });

  it("syncing a mirror that is off is rejected and leaves it off", async () => {
    const { ctx, db, google } = await setup();
    await enableMirror(ctx, TRIP_ID, USERS.kenny.id);
    await disableMirror(ctx, TRIP_ID, USERS.kenny.id);
    google.calls = [];
    await expect(syncMirror(ctx, TRIP_ID, USERS.kenny.id)).rejects.toThrow("Calendar mirroring is off for this trip.");
    expect(google.calls).toEqual([]);
    const [mirror] = await db.select().from(t.calendarMirrors).where(eq(t.calendarMirrors.userId, USERS.kenny.id));
    expect(mirror.enabled).toBe(false);
  });

  it("a torn down mirror cannot be revived by a sync", async () => {
    const { ctx, db } = await setup();
    await enableMirror(ctx, TRIP_ID, USERS.jacob.id);
    await db.delete(t.memberships).where(eq(t.memberships.userId, USERS.jacob.id));
    await syncMirror(ctx, TRIP_ID, USERS.jacob.id);
    await expect(syncMirror(ctx, TRIP_ID, USERS.jacob.id)).rejects.toThrow("off for this trip");
  });

  it("the full fixture import, approved, mirrors cleanly", async () => {
    const { ctx, google } = await setup();
    await enableMirror(ctx, TRIP_ID, USERS.kenny.id);
    await importCalendarEvents(ctx, TRIP_ID, kenny, fixtureEvents, { source: "google_calendar", label: "Calendars" });
    expect(google.allEvents()).toHaveLength(13);
  });
});
