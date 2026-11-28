import { describe, expect, it } from "vitest";
import { present } from "@/testing/present";
import { fixture, TRAVELERS, TRIP_ID } from "@/fixtures/december-trip";
import type { CalendarEvent } from "@/domain/import/calendar-event";
import { InputProblem } from "@/domain/import/problem";
import { AccessDenied } from "@/domain/visibility/project";
import * as t from "../db/schema";
import { FakeGoogleCalendar, GoogleAuthorizationError } from "../google/calendar-api";
import { importFromGoogle } from "../google/import";
import { jacob, kenny, testContext } from "../testing";
import { approveAllClean, approveEntry, disagreementFindings, listInbox, NeedsDecision } from "./inbox-service";
import { getTripView, removeItem } from "./trip-service";

const calendarTravelers = {
  "kenny primary": [TRAVELERS.kenny],
  "kenny primary (from Gmail)": [TRAVELERS.kenny],
  "shared China": [TRAVELERS.kenny, TRAVELERS.jacob],
};

const fixtureEvents: CalendarEvent[] = fixture.calendarEvents;
const names = [...new Set(fixtureEvents.map((e) => e.calendar))].filter((n): n is string => typeof n === "string");

function seededAccount() {
  const google = new FakeGoogleCalendar();
  const ids = Object.fromEntries(names.map((name) => [name, google.seedCalendar(name, fixtureEvents.filter((e) => e.calendar === name))]));
  return { google, ids, all: Object.values(ids) };
}

const december = { from: "2026-11-30", to: "2026-12-16", calendarTravelers };

describe("importing the fixture's calendars from Google", () => {
  it("puts NH159 in the inbox merged with both travelers' seats, and nothing on the trip until someone approves", async () => {
    const { ctx, changed } = await testContext({ withItems: false });
    const { google, all } = seededAccount();
    const result = await importFromGoogle(ctx, google, TRIP_ID, kenny, { calendarIds: all, ...december });
    expect(result.events).toBe(fixtureEvents.length);
    expect(result.calendars).toEqual(names);
    const nh159 = present((await listInbox(ctx, TRIP_ID, kenny)).find((e) => e.proposed.title === "NH159"));
    expect(nh159.proposed.private.map((p) => p.seat)).toEqual(["30K", "30C"]);
    expect(nh159.proposed.travelerIds).toEqual([TRAVELERS.kenny, TRAVELERS.jacob]);
    expect((await getTripView(ctx, TRIP_ID, kenny)).items).toEqual([]);
    expect(changed).toEqual([]);
  });

  it("shows the CX509 disagreement and makes the person choose before it is added", async () => {
    const { ctx } = await testContext({ withItems: false });
    const { google, all } = seededAccount();
    await importFromGoogle(ctx, google, TRIP_ID, kenny, { calendarIds: all, ...december });
    const cx509 = present((await listInbox(ctx, TRIP_ID, kenny)).find((e) => e.proposed.title === "CX509"));
    await expect(approveEntry(ctx, TRIP_ID, cx509.id, kenny)).rejects.toThrow(NeedsDecision);
    const sentences = (await disagreementFindings(ctx, TRIP_ID, kenny)).map((f) => f.sentence);
    expect(sentences).toHaveLength(1);
    expect(sentences[0]).toMatch(/^Two records for CX509 disagree on departure: (9:00am and 8:50am|8:50am and 9:00am)\.$/);
  });

  it("makes the $1,183.22 stay only a possible match for the Airbnb, never added in bulk", async () => {
    const { ctx } = await testContext();
    const existing = present((await getTripView(ctx, TRIP_ID, kenny)).items.find((i) => i.title.startsWith("Stay at Total")));
    await removeItem(ctx, TRIP_ID, existing.id, kenny);
    const { google, all } = seededAccount();
    await importFromGoogle(ctx, google, TRIP_ID, kenny, { calendarIds: all, ...december });
    const total = present((await listInbox(ctx, TRIP_ID, kenny)).find((e) => e.proposed.title.startsWith("Stay at Total")));
    expect(total.match?.strength).toBe("possible");
    expect(total.clean).toBe(false);
    await expect(approveAllClean(ctx, TRIP_ID, kenny)).resolves.toMatchObject({ added: 0 });
    expect((await getTripView(ctx, TRIP_ID, kenny)).items.some((i) => i.title.startsWith("Stay at Total"))).toBe(false);
  });

  it("proposes the cancellation deadlines found in the events", async () => {
    const { ctx } = await testContext({ withItems: false });
    const { google, all } = seededAccount();
    await importFromGoogle(ctx, google, TRIP_ID, kenny, { calendarIds: all, ...december });
    const withDeadlines = (await listInbox(ctx, TRIP_ID, kenny)).filter((e) => e.proposed.deadlines.length > 0);
    expect(withDeadlines.length).toBeGreaterThan(0);
    expect(withDeadlines.every((e) => e.proposed.deadlines.every((d) => d.source === "parsed"))).toBe(true);
  });

  it("imports only the chosen calendars and only events near the date range (a day of padding either side, so time zones do not cut off the first and last day)", async () => {
    const { ctx } = await testContext({ withItems: false });
    const { google, ids } = seededAccount();
    const shared = ids["shared China"];
    const result = await importFromGoogle(ctx, google, TRIP_ID, kenny, { calendarIds: [shared], from: "2026-12-14", to: "2026-12-16", calendarTravelers });
    expect(result.calendars).toEqual(["shared China"]);
    const inbox = await listInbox(ctx, TRIP_ID, kenny);
    expect(inbox.map((e) => e.proposed.title).sort()).toEqual(["CX520", "Hotel Resol Ueno", "NH160"]);
    expect(google.reads).toEqual(["listCalendars", `listEvents ${shared}`]);
  });

  it("refuses a calendar that is not in the person's Google account, before reading any events", async () => {
    const { ctx } = await testContext({ withItems: false });
    const { google, all } = seededAccount();
    await expect(importFromGoogle(ctx, google, TRIP_ID, kenny, { calendarIds: [all[0], "someone-else@group.calendar.google.com"], ...december })).rejects.toThrow(InputProblem);
    expect(google.reads).toEqual(["listCalendars"]);
    expect(await listInbox(ctx, TRIP_ID, kenny)).toEqual([]);
  });

  it.each([
    ["no calendars", { calendarIds: [], from: "2026-12-01", to: "2026-12-15" }],
    ["a missing date", { calendarIds: ["x"], from: "", to: "2026-12-15" }],
    ["a date that is not a date", { calendarIds: ["x"], from: "2026-12-01", to: "tomorrow" }],
    ["an end before the start", { calendarIds: ["x"], from: "2026-12-15", to: "2026-12-01" }],
    ["a range of years", { calendarIds: ["x"], from: "2020-01-01", to: "2026-12-15" }],
    ["too many calendars", { calendarIds: Array.from({ length: 11 }, (_, i) => `c${i}`), from: "2026-12-01", to: "2026-12-15" }],
  ])("refuses %s without calling Google", async (_name, input) => {
    const { ctx } = await testContext({ withItems: false });
    const { google } = seededAccount();
    await expect(importFromGoogle(ctx, google, TRIP_ID, kenny, input)).rejects.toThrow(InputProblem);
    expect(google.reads).toEqual([]);
  });

  it("does not call Google at all for a viewer", async () => {
    const { ctx, db } = await testContext({ withItems: false });
    const { eq } = await import("drizzle-orm");
    await db.update(t.memberships).set({ role: "viewer" }).where(eq(t.memberships.userId, jacob.kind === "member" ? jacob.userId : ""));
    const { google, all } = seededAccount();
    await expect(importFromGoogle(ctx, google, TRIP_ID, jacob, { calendarIds: all, ...december })).rejects.toThrow(AccessDenied);
    expect(google.reads).toEqual([]);
  });

  it("keeps no Google token or connection, and labels the batch without calendar names", async () => {
    const { ctx, db } = await testContext({ withItems: false });
    const { google, all } = seededAccount();
    await importFromGoogle(ctx, google, TRIP_ID, kenny, { calendarIds: all, ...december });
    expect(await db.select().from(t.googleConnections)).toEqual([]);
    const batches = await db.select().from(t.importBatches);
    expect(batches).toHaveLength(1);
    expect(batches[0].source).toBe("google_calendar");
    expect(batches[0].label).toBe("Google Calendar, 3 calendars");
    for (const name of names) expect(batches[0].label).not.toContain(name);
  });

  it("surfaces a refused token as an authorization error and imports nothing", async () => {
    const { ctx } = await testContext({ withItems: false });
    const { google, all } = seededAccount();
    google.failNext = new GoogleAuthorizationError(401, "Google Calendar GET failed: 401");
    await expect(importFromGoogle(ctx, google, TRIP_ID, kenny, { calendarIds: all, ...december })).rejects.toThrow(GoogleAuthorizationError);
    expect(await listInbox(ctx, TRIP_ID, kenny)).toEqual([]);
  });

  it("imports nothing and says nothing was found when the range holds no events", async () => {
    const { ctx } = await testContext({ withItems: false });
    const { google, all } = seededAccount();
    const result = await importFromGoogle(ctx, google, TRIP_ID, kenny, { calendarIds: all, from: "2027-03-01", to: "2027-03-05", calendarTravelers });
    expect(result.events).toBe(0);
    expect(await listInbox(ctx, TRIP_ID, kenny)).toEqual([]);
  });
});
