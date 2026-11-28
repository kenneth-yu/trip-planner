import { describe, expect, it } from "vitest";
import { runChecks } from "@/domain/checks/checks";
import { present } from "@/testing/present";
import { fixture, TRAVELERS, TRIP_ID } from "@/fixtures/december-trip";
import type { CalendarEvent } from "@/domain/import/calendar-event";
import { InputProblem } from "@/domain/import/problem";
import { AccessDenied } from "@/domain/visibility/project";
import * as t from "../db/schema";
import { FakeGoogleCalendar, googleCalendarReader, GoogleAuthorizationError, type GoogleCalendarReader } from "../google/calendar-api";
import { defaultImportRange, importFromGoogle, MAX_EVENTS } from "../google/import";
import type { Geocoder } from "../places/geocoder";
import { jacob, kenny, testContext } from "../testing";
import { approveAllClean, approveEntry, disagreementFindings, importCalendarEvents, listInbox, NeedsDecision } from "./inbox-service";
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

function pagedGoogle(pageSize: number, calendars: Record<string, CalendarEvent[]>, extra: Record<string, unknown> = {}) {
  const ids = new Map(Object.keys(calendars).map((name, i) => [`cal${i}@group.calendar.google.com`, name]));
  const requests: string[] = [];
  const fetchImpl: typeof fetch = async (input) => {
    const url = new URL(String(input));
    requests.push(`${url.pathname}${url.searchParams.get("pageToken") ? `?page=${url.searchParams.get("pageToken")}` : ""}`);
    if (url.pathname.endsWith("/users/me/calendarList")) {
      return Response.json({ items: [...ids].map(([id, name]) => ({ id, summary: name, primary: name === "kenny primary" })) });
    }
    const id = decodeURIComponent(url.pathname.split("/")[4] ?? "");
    const name = ids.get(id);
    if (!name) return new Response("", { status: 404 });
    const from = Date.parse(url.searchParams.get("timeMin") ?? "");
    const to = Date.parse(url.searchParams.get("timeMax") ?? "");
    const edge = (time: { dateTime?: string; date?: string }) => Date.parse(time.dateTime ?? `${time.date}T00:00:00Z`);
    const inRange = (calendars[name] ?? []).filter((e) => edge(e.end) > from && edge(e.start) < to).map((e, i) => ({ ...e, id: `${id}-${i}`, calendar: undefined }));
    const start = Number(url.searchParams.get("pageToken") ?? 0);
    const next = start + pageSize;
    return Response.json({ items: inRange.slice(start, next), nextPageToken: next < inRange.length ? String(next) : undefined, ...extra });
  };
  return { reader: googleCalendarReader(async () => "ya29.read", fetchImpl), requests };
}

const fixtureByCalendar = () => Object.fromEntries(names.map((name) => [name, fixtureEvents.filter((e) => e.calendar === name)]));

describe("importing the fixture through the real Google reader, a few events to a page", () => {
  async function importAll() {
    const { ctx, db } = await testContext({ withItems: false });
    const google = pagedGoogle(3, fixtureByCalendar());
    const offered = await google.reader.listCalendars();
    const result = await importFromGoogle(ctx, google.reader, TRIP_ID, kenny, { calendarIds: offered.map((c) => c.id), ...december });
    return { ctx, db, google, result };
  }

  it("reads every page of every calendar and finds the same events as the fake does", async () => {
    const { result, google } = await importAll();
    expect(result.events).toBe(fixtureEvents.length);
    expect(google.requests.some((r) => r.includes("?page="))).toBe(true);
  });

  it("proposes the stay with the $1,183.22 amount in its title, and it overlaps the Airbnb from Dec 10 to 13 once both are added", async () => {
    const { ctx } = await importAll();
    const inbox = await listInbox(ctx, TRIP_ID, kenny);
    const total = present(inbox.find((e) => e.proposed.title === "Stay at Total (USD) $1,183.22"));
    expect(total.proposed.type).toBe("stay");
    for (const entry of inbox) {
      if (entry.proposed.title === "CX509") await approveEntry(ctx, TRIP_ID, entry.id, kenny, { choices: { start: 1 } });
      else await approveEntry(ctx, TRIP_ID, entry.id, kenny);
    }
    const sentences = runChecks(await getTripView(ctx, TRIP_ID, kenny)).map((f) => f.sentence);
    expect(sentences).toContain("Two stays overlap Dec 10 to 13: Airbnb, 528 Nathan Road and 'Stay at Total (USD) $1,183.22'. Check whether one is a duplicate.");
  });

  it("proposes exactly the four cancellation deadlines the events name, each with its instant and its zone", async () => {
    const { ctx } = await importAll();
    const found = (await listInbox(ctx, TRIP_ID, kenny)).flatMap((e) => e.proposed.deadlines.map((d) => ({ title: e.proposed.title, kind: d.kind, instant: Date.parse(d.at.at), zone: d.at.zone, consequence: d.consequence })));
    const local = (iso: string) => Date.parse(iso);
    expect(found).toEqual(
      expect.arrayContaining([
        { title: "Hotel Resol Ueno", kind: "free_cancellation", instant: local("2026-11-28T23:59:00+09:00"), zone: "Asia/Tokyo", consequence: "Non refundable after this" },
        { title: "Head spa, Belle Cheveu Hiroo", kind: "change", instant: local("2026-11-29T10:00:00+09:00"), zone: "Asia/Tokyo", consequence: "Changes cost extra after this" },
        { title: "Mumian Hotel Luohu", kind: "free_cancellation", instant: local("2026-12-05T00:00:00+08:00"), zone: "Asia/Shanghai", consequence: "Non refundable after this" },
        { title: "Airbnb, 528 Nathan Road", kind: "partial_refund", instant: local("2026-12-03T14:00:00+08:00"), zone: "Asia/Hong_Kong", consequence: "Only a partial refund before this, none after" },
      ]),
    );
    expect(found).toHaveLength(4);
  });
});

describe("all-day stays at the edges of the range", () => {
  const stay = (summary: string, date: string, endDate: string): CalendarEvent => ({ id: summary, summary, calendar: "c", start: { date }, end: { date: endDate }, location: "Somewhere Hotel, Tokyo" });

  async function titlesFor(from: string, to: string, events: CalendarEvent[]) {
    const { ctx } = await testContext({ withItems: false });
    const google = new FakeGoogleCalendar();
    const id = google.seedCalendar("c", events);
    await importFromGoogle(ctx, google, TRIP_ID, kenny, { calendarIds: [id], from, to });
    return (await listInbox(ctx, TRIP_ID, kenny)).map((e) => e.proposed.title).sort();
  }

  it("keeps a stay that ends the day the range starts, and one that starts the day the range ends, because of the day of padding", async () => {
    const titles = await titlesFor("2026-12-05", "2026-12-08", [
      stay("Hotel ends before", "2026-12-02", "2026-12-05"),
      stay("Hotel starts after", "2026-12-08", "2026-12-10"),
    ]);
    expect(titles).toHaveLength(2);
  });

  it("drops a stay that is two days outside either end", async () => {
    const titles = await titlesFor("2026-12-05", "2026-12-08", [
      stay("Hotel too early", "2026-12-01", "2026-12-03"),
      stay("Hotel too late", "2026-12-10", "2026-12-12"),
    ]);
    expect(titles).toEqual([]);
  });

  it("keeps a stay that spans the whole range", async () => {
    expect(await titlesFor("2026-12-05", "2026-12-08", [stay("Hotel all through", "2026-12-01", "2026-12-20")])).toHaveLength(1);
  });
});

describe("the caps on what one import takes in", () => {
  it("asks each calendar for no more than what is left of 500 events", async () => {
    const { ctx } = await testContext({ withItems: false });
    const limits: Array<number | undefined> = [];
    const google = new FakeGoogleCalendar();
    const one = google.seedCalendar("one", fixtureEvents.filter((e) => e.calendar === "shared China").slice(0, 2));
    const two = google.seedCalendar("two", []);
    const watched: GoogleCalendarReader = {
      listCalendars: () => google.listCalendars(),
      listEvents: (id, range, limit) => {
        limits.push(limit);
        return google.listEvents(id, range, limit);
      },
    };
    await importFromGoogle(ctx, watched, TRIP_ID, kenny, { calendarIds: [one, two], ...december });
    expect(limits).toEqual([MAX_EVENTS, MAX_EVENTS - 2]);
  });

  it("refuses more than 500 events with a plain line and imports nothing", async () => {
    const { ctx } = await testContext({ withItems: false });
    const many: CalendarEvent[] = Array.from({ length: MAX_EVENTS + 1 }, (_, i) => ({ id: `e${i}`, summary: `Event ${i}`, start: { date: "2026-12-02" }, end: { date: "2026-12-03" } }));
    const google = new FakeGoogleCalendar();
    const id = google.seedCalendar("busy", many);
    await expect(importFromGoogle(ctx, google, TRIP_ID, kenny, { calendarIds: [id], ...december })).rejects.toThrow("That range has more than 500 events. Choose fewer calendars or a shorter range.");
    expect(await listInbox(ctx, TRIP_ID, kenny)).toEqual([]);
  });

  it("refuses 500 events spread over several calendars once they add up to more", async () => {
    const { ctx } = await testContext({ withItems: false });
    const some = (n: number): CalendarEvent[] => Array.from({ length: n }, (_, i) => ({ id: `e${i}`, summary: `Event ${i}`, start: { date: "2026-12-02" }, end: { date: "2026-12-03" } }));
    const google = new FakeGoogleCalendar();
    const a = google.seedCalendar("a", some(300));
    const b = google.seedCalendar("b", some(201));
    await expect(importFromGoogle(ctx, google, TRIP_ID, kenny, { calendarIds: [a, b], ...december })).rejects.toThrow(InputProblem);
    expect(await listInbox(ctx, TRIP_ID, kenny)).toEqual([]);
  });

  it.each([
    ["364 days", "2026-01-01", "2026-12-30", true],
    ["365 days", "2026-01-01", "2026-12-31", false],
    ["a year and a day", "2026-01-01", "2027-01-01", false],
  ])("takes a range of %s: %s", async (_name, from, to, allowed) => {
    const { ctx } = await testContext({ withItems: false });
    const google = new FakeGoogleCalendar();
    const id = google.seedCalendar("c", []);
    const attempt = importFromGoogle(ctx, google, TRIP_ID, kenny, { calendarIds: [id], from, to });
    if (allowed) await expect(attempt).resolves.toMatchObject({ events: 0 });
    else await expect(attempt).rejects.toThrow("Choose a range shorter than a year.");
  });

  it("never sends a Google event's location to the address lookup, though other imports still do", async () => {
    const lookups: string[] = [];
    const geocoder: Geocoder = {
      lookup: async (query) => {
        lookups.push(query);
        return null;
      },
    };
    const { ctx } = await testContext({ withItems: false, overrides: { geocoder } });
    const { google, all } = seededAccount();
    await importFromGoogle(ctx, google, TRIP_ID, kenny, { calendarIds: all, ...december });
    expect(lookups).toEqual([]);
    await importCalendarEvents(ctx, TRIP_ID, kenny, fixtureEvents, { source: "ics", label: "file" });
    expect(lookups.length).toBeGreaterThan(0);
  });
});

describe("the dates the form starts with", () => {
  const today = new Date("2026-11-27T12:00:00Z");

  it("pads the trip's own dates by a day each side", () => {
    expect(defaultImportRange(["2026-12-01T05:55:00Z", "2026-12-02T06:00:00Z"], ["2026-12-15T12:55:00Z", "2026-12-14T00:00:00Z"], today)).toEqual({ from: "2026-11-30", to: "2026-12-16" });
  });

  it("is today to 60 days on when the trip has nothing yet", () => {
    expect(defaultImportRange([], [], today)).toEqual({ from: "2026-11-27", to: "2027-01-26" });
  });

  it("never starts a range the import itself would refuse", async () => {
    const range = defaultImportRange(["2020-01-01T00:00:00Z"], ["2026-12-15T00:00:00Z"], today);
    const { ctx } = await testContext({ withItems: false });
    const google = new FakeGoogleCalendar();
    const id = google.seedCalendar("c", []);
    await expect(importFromGoogle(ctx, google, TRIP_ID, kenny, { calendarIds: [id], ...range })).resolves.toMatchObject({ events: 0 });
  });
});

describe("the calendars on offer", () => {
  it("are the person's own, and refuse the calendar this app keeps in sync", async () => {
    const { ctx } = await testContext({ withItems: false });
    const google = new FakeGoogleCalendar();
    const mine = google.seedCalendar("Mine", []);
    const mirror = google.seedCalendar("Asia, December 2026 (Trip planner)", []);
    expect((await google.listCalendars()).map((c) => c.id)).toEqual([mine]);
    await expect(importFromGoogle(ctx, google, TRIP_ID, kenny, { calendarIds: [mirror], ...december })).rejects.toThrow(InputProblem);
    expect(google.reads).toEqual(["listCalendars", "listCalendars"]);
  });
});
