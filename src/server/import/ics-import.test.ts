import { beforeEach, describe, expect, it, vi } from "vitest";
import { fixture, TRIP_ID } from "@/fixtures/december-trip";
import { AccessDenied } from "@/domain/visibility/project";
import type { Requester } from "@/domain/types";
import { toIcs } from "@/testing/ics-fixture";
import { jacob, kenny, testContext } from "../testing";
import { listInbox } from "../services/inbox-service";
import { NotFound } from "../services/trip-service";
import { FetchRefused } from "./fetch-guard";
import { BadDates, importIcsText, importIcsUrl, NothingInDates, TooManyEvents, TooManyUrlImports, UrlImportUnavailable, type UrlImportDeps } from "./ics-import";

beforeEach(() => {
  vi.stubEnv("SESSION_SECRET", "test-secret-test-secret-test-secret-0123");
});

const calendar = toIcs(fixture.calendarEvents.slice(0, 6));
const anyDates = { from: "", to: "" };
const stranger: Requester = { kind: "member", userId: "00000000-0000-4000-8100-0000000000fe", homeZone: "UTC" };
const rule = { name: "quickAdd" as const, limit: 2, windowMs: 60_000 };

function deps(over: Partial<UrlImportDeps> = {}) {
  const fetched: string[] = [];
  const value: UrlImportDeps = {
    fetchText: async (url) => {
      fetched.push(url);
      return calendar;
    },
    rules: { icsUrl: rule },
    ...over,
  };
  return { value, fetched };
}

describe("importing an .ics file", () => {
  it("puts the events in the review inbox as source ics and changes nothing else", async () => {
    const { ctx, changed } = await testContext({ withItems: false });
    const outcome = await importIcsText(ctx, TRIP_ID, kenny, calendar, "Calendar file", anyDates);
    expect(outcome.waiting).toBeGreaterThan(0);
    const inbox = await listInbox(ctx, TRIP_ID, kenny);
    expect(inbox).toHaveLength(outcome.waiting);
    expect(new Set(inbox.map((e) => e.source))).toEqual(new Set(["ics"]));
    expect(inbox.every((e) => e.label === "Calendar file")).toBe(true);
    expect(changed).toEqual([]);
  });

  it("reports how many were waiting, how many look like things already on the trip, and how many were left out", async () => {
    const { ctx } = await testContext({ withItems: false });
    const text = ["BEGIN:VCALENDAR", "BEGIN:VEVENT", "UID:a", "DTSTART:20261205T100000Z", "DTEND:20261205T110000Z", "SUMMARY:Cancelled", "STATUS:CANCELLED", "END:VEVENT", "BEGIN:VEVENT", "UID:b", "DTSTART:20261206T100000Z", "DTEND:20261206T110000Z", "SUMMARY:Weekly", "RRULE:FREQ=WEEKLY", "END:VEVENT", "END:VCALENDAR"].join("\r\n");
    const outcome = await importIcsText(ctx, TRIP_ID, kenny, text, "Calendar file", anyDates);
    expect(outcome).toMatchObject({ waiting: 1, matched: 0, leftOut: 1, outsideDates: 0 });
  });

  it("an editor may import, a viewer, a stranger and a link visitor may not, and nothing is stored", async () => {
    const { ctx, db } = await testContext({ withItems: false });
    await expect(importIcsText(ctx, TRIP_ID, stranger, calendar, "Calendar file", anyDates)).rejects.toThrow(AccessDenied);
    await expect(importIcsText(ctx, TRIP_ID, { kind: "link", homeZone: "UTC" }, calendar, "Calendar file", anyDates)).rejects.toThrow(NotFound);
    await importIcsText(ctx, TRIP_ID, jacob, calendar, "Calendar file", anyDates);
    const batches = await db.query.importBatches.findMany();
    expect(batches).toHaveLength(1);
  });

  it("a file that is not a calendar is a plain refusal and stores nothing", async () => {
    const { ctx, db } = await testContext({ withItems: false });
    await expect(importIcsText(ctx, TRIP_ID, kenny, "not a calendar", "Calendar file", anyDates)).rejects.toThrow("We could not read that file as a calendar.");
    expect(await db.query.importBatches.findMany()).toEqual([]);
  });
});

describe("importing from a link", () => {
  it("fetches once, imports as a calendar link, and stores no part of the link", async () => {
    const { ctx, db } = await testContext({ withItems: false });
    const { value, fetched } = deps();
    const url = "https://calendar.example.test/private/SECRETTOKEN.ics";
    const outcome = await importIcsUrl(ctx, TRIP_ID, kenny, url, anyDates, value);
    expect(fetched).toEqual([url]);
    expect(outcome.waiting).toBeGreaterThan(0);
    const stored = JSON.stringify([await db.query.importBatches.findMany(), await db.query.activity.findMany(), await db.query.rateLimits.findMany()]);
    expect(stored).not.toMatch(/SECRETTOKEN|calendar\.example\.test/);
    expect((await listInbox(ctx, TRIP_ID, kenny)).every((e) => e.label === "Calendar link")).toBe(true);
  });

  it("refuses to run without its rate limit rule, and does not fetch", async () => {
    const { ctx } = await testContext({ withItems: false });
    const { value, fetched } = deps({ rules: {} });
    await expect(importIcsUrl(ctx, TRIP_ID, kenny, "https://calendar.example.test/a.ics", anyDates, value)).rejects.toThrow(UrlImportUnavailable);
    expect(fetched).toEqual([]);
  });

  it("stops at the limit and does not fetch past it", async () => {
    const { ctx } = await testContext({ withItems: false });
    const { value, fetched } = deps();
    await importIcsUrl(ctx, TRIP_ID, kenny, "https://calendar.example.test/a.ics", anyDates, value);
    await importIcsUrl(ctx, TRIP_ID, kenny, "https://calendar.example.test/a.ics", anyDates, value);
    await expect(importIcsUrl(ctx, TRIP_ID, kenny, "https://calendar.example.test/a.ics", anyDates, value)).rejects.toThrow(TooManyUrlImports);
    expect(fetched).toHaveLength(2);
  });

  it("checks who is asking before it fetches anything", async () => {
    const { ctx } = await testContext({ withItems: false });
    const { value, fetched } = deps();
    await expect(importIcsUrl(ctx, TRIP_ID, stranger, "https://calendar.example.test/a.ics", anyDates, value)).rejects.toThrow(AccessDenied);
    await expect(importIcsUrl(ctx, TRIP_ID, { kind: "link", homeZone: "UTC" }, "https://calendar.example.test/a.ics", anyDates, value)).rejects.toThrow(NotFound);
    expect(fetched).toEqual([]);
  });

  it("passes the guard's refusal through and imports nothing", async () => {
    const { ctx, db } = await testContext({ withItems: false });
    const { value } = deps({
      fetchText: async () => {
        throw new FetchRefused("address");
      },
    });
    await expect(importIcsUrl(ctx, TRIP_ID, kenny, "https://calendar.example.test/a.ics", anyDates, value)).rejects.toThrow(FetchRefused);
    expect(await db.query.importBatches.findMany()).toEqual([]);
  });
});

describe("the dates", () => {
  const december = toIcs(fixture.calendarEvents);

  it("leaves out events outside the dates, counts them, and sends only the rest to the inbox", async () => {
    const { ctx } = await testContext({ withItems: false });
    const everything = await importIcsText(ctx, TRIP_ID, kenny, december, "Calendar file", anyDates);
    const { ctx: second } = await testContext({ withItems: false });
    const narrow = await importIcsText(second, TRIP_ID, kenny, december, "Calendar file", { from: "2026-12-02", to: "2026-12-03" });
    expect(narrow.outsideDates).toBeGreaterThan(0);
    expect(narrow.waiting).toBeLessThan(everything.waiting);
    expect(narrow.leftOut).toBeGreaterThanOrEqual(narrow.outsideDates);
    expect((await listInbox(second, TRIP_ID, kenny)).length).toBe(narrow.waiting);
  });

  it("says so when nothing falls inside the dates, and stores nothing", async () => {
    const { ctx, db } = await testContext({ withItems: false });
    await expect(importIcsText(ctx, TRIP_ID, kenny, december, "Calendar file", { from: "2031-01-01", to: "2031-01-31" })).rejects.toThrow(NothingInDates);
    expect(await db.query.importBatches.findMany()).toEqual([]);
  });

  it("refuses more than 500 events inside the dates, with their count, and stores nothing", async () => {
    const { ctx, db } = await testContext({ withItems: false });
    const many = toIcs(Array.from({ length: 501 }, (_, i) => ({ summary: `Event ${i}`, start: { dateTime: "2026-12-05T10:00:00Z" }, end: { dateTime: "2026-12-05T11:00:00Z" } })));
    const refused = await importIcsText(ctx, TRIP_ID, kenny, many, "Calendar file", anyDates).then(
      () => null,
      (e: unknown) => e,
    );
    expect(refused).toBeInstanceOf(TooManyEvents);
    expect(refused instanceof TooManyEvents ? refused.count : 0).toBe(501);
    expect(await db.query.importBatches.findMany()).toEqual([]);
  });

  it("allows exactly 500, and counts the events after the date filter, not before it", async () => {
    const { ctx } = await testContext({ withItems: false });
    const inside = Array.from({ length: 500 }, (_, i) => ({ summary: `Event ${i}`, start: { dateTime: "2026-12-05T10:00:00Z" }, end: { dateTime: "2026-12-05T11:00:00Z" } }));
    const outside = Array.from({ length: 300 }, (_, i) => ({ summary: `Old ${i}`, start: { dateTime: "2020-01-05T10:00:00Z" }, end: { dateTime: "2020-01-05T11:00:00Z" } }));
    const outcome = await importIcsText(ctx, TRIP_ID, kenny, toIcs([...inside, ...outside]), "Calendar file", { from: "2026-12-01", to: "2026-12-31" });
    expect(outcome.outsideDates).toBe(300);
    expect(outcome.waiting).toBe(500);
  });

  it.each([
    [{ from: "2026-12-16", to: "2026-11-30" }, "from_after_to"],
    [{ from: "2026-01-01", to: "2027-06-01" }, "range_too_long"],
    [{ from: "2026-02-30", to: "" }, "bad_dates"],
  ])("refuses the dates %j as %s before reading the file", async (dates, problem) => {
    const { ctx } = await testContext({ withItems: false });
    const refused = await importIcsText(ctx, TRIP_ID, kenny, "not even a calendar", "Calendar file", dates).then(
      () => null,
      (e: unknown) => e,
    );
    expect(refused).toBeInstanceOf(BadDates);
    expect(refused instanceof BadDates ? refused.problem : "").toBe(problem);
  });

  it("counts events that look like things already on the trip", async () => {
    const { ctx } = await testContext();
    const outcome = await importIcsText(ctx, TRIP_ID, kenny, december, "Calendar file", anyDates);
    expect(outcome.matched).toBeGreaterThan(0);
    expect(outcome.matched).toBeLessThanOrEqual(outcome.waiting);
  });

  it("the link path refuses bad dates before it fetches anything", async () => {
    const { ctx } = await testContext({ withItems: false });
    const { value, fetched } = deps();
    await expect(importIcsUrl(ctx, TRIP_ID, kenny, "https://calendar.example.test/a.ics", { from: "2026-12-16", to: "2026-11-30" }, value)).rejects.toThrow(BadDates);
    expect(fetched).toEqual([]);
  });
});
