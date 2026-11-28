import { beforeEach, describe, expect, it, vi } from "vitest";
import { fixture, TRIP_ID } from "@/fixtures/december-trip";
import { AccessDenied } from "@/domain/visibility/project";
import type { Requester } from "@/domain/types";
import { toIcs } from "@/testing/ics-fixture";
import { jacob, kenny, testContext } from "../testing";
import { listInbox } from "../services/inbox-service";
import { NotFound } from "../services/trip-service";
import { FetchRefused } from "./fetch-guard";
import { importIcsText, importIcsUrl, TooManyUrlImports, UrlImportUnavailable, type UrlImportDeps } from "./ics-import";

beforeEach(() => {
  vi.stubEnv("SESSION_SECRET", "test-secret-test-secret-test-secret-0123");
});

const calendar = toIcs(fixture.calendarEvents.slice(0, 6));
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
    const outcome = await importIcsText(ctx, TRIP_ID, kenny, calendar, "Calendar file");
    expect(outcome.count).toBeGreaterThan(0);
    const inbox = await listInbox(ctx, TRIP_ID, kenny);
    expect(inbox).toHaveLength(outcome.count);
    expect(new Set(inbox.map((e) => e.source))).toEqual(new Set(["ics"]));
    expect(inbox.every((e) => e.label === "Calendar file")).toBe(true);
    expect(changed).toEqual([]);
  });

  it("reports what it skipped and what repeats", async () => {
    const { ctx } = await testContext({ withItems: false });
    const text = ["BEGIN:VCALENDAR", "BEGIN:VEVENT", "UID:a", "DTSTART:20261205T100000Z", "DTEND:20261205T110000Z", "SUMMARY:Cancelled", "STATUS:CANCELLED", "END:VEVENT", "BEGIN:VEVENT", "UID:b", "DTSTART:20261206T100000Z", "DTEND:20261206T110000Z", "SUMMARY:Weekly", "RRULE:FREQ=WEEKLY", "END:VEVENT", "END:VCALENDAR"].join("\r\n");
    const outcome = await importIcsText(ctx, TRIP_ID, kenny, text, "Calendar file");
    expect(outcome).toMatchObject({ count: 1, skipped: 1, repeating: 1 });
  });

  it("an editor may import, a viewer, a stranger and a link visitor may not, and nothing is stored", async () => {
    const { ctx, db } = await testContext({ withItems: false });
    await expect(importIcsText(ctx, TRIP_ID, stranger, calendar, "Calendar file")).rejects.toThrow(AccessDenied);
    await expect(importIcsText(ctx, TRIP_ID, { kind: "link", homeZone: "UTC" }, calendar, "Calendar file")).rejects.toThrow(NotFound);
    await importIcsText(ctx, TRIP_ID, jacob, calendar, "Calendar file");
    const batches = await db.query.importBatches.findMany();
    expect(batches).toHaveLength(1);
  });

  it("a file that is not a calendar is a plain refusal and stores nothing", async () => {
    const { ctx, db } = await testContext({ withItems: false });
    await expect(importIcsText(ctx, TRIP_ID, kenny, "not a calendar", "Calendar file")).rejects.toThrow("We could not read that file as a calendar.");
    expect(await db.query.importBatches.findMany()).toEqual([]);
  });
});

describe("importing from a link", () => {
  it("fetches once, imports as a calendar link, and stores no part of the link", async () => {
    const { ctx, db } = await testContext({ withItems: false });
    const { value, fetched } = deps();
    const url = "https://calendar.example.test/private/SECRETTOKEN.ics";
    const outcome = await importIcsUrl(ctx, TRIP_ID, kenny, url, value);
    expect(fetched).toEqual([url]);
    expect(outcome.count).toBeGreaterThan(0);
    const stored = JSON.stringify([await db.query.importBatches.findMany(), await db.query.activity.findMany(), await db.query.rateLimits.findMany()]);
    expect(stored).not.toMatch(/SECRETTOKEN|calendar\.example\.test/);
    expect((await listInbox(ctx, TRIP_ID, kenny)).every((e) => e.label === "Calendar link")).toBe(true);
  });

  it("refuses to run without its rate limit rule, and does not fetch", async () => {
    const { ctx } = await testContext({ withItems: false });
    const { value, fetched } = deps({ rules: {} });
    await expect(importIcsUrl(ctx, TRIP_ID, kenny, "https://calendar.example.test/a.ics", value)).rejects.toThrow(UrlImportUnavailable);
    expect(fetched).toEqual([]);
  });

  it("stops at the limit and does not fetch past it", async () => {
    const { ctx } = await testContext({ withItems: false });
    const { value, fetched } = deps();
    await importIcsUrl(ctx, TRIP_ID, kenny, "https://calendar.example.test/a.ics", value);
    await importIcsUrl(ctx, TRIP_ID, kenny, "https://calendar.example.test/a.ics", value);
    await expect(importIcsUrl(ctx, TRIP_ID, kenny, "https://calendar.example.test/a.ics", value)).rejects.toThrow(TooManyUrlImports);
    expect(fetched).toHaveLength(2);
  });

  it("checks who is asking before it fetches anything", async () => {
    const { ctx } = await testContext({ withItems: false });
    const { value, fetched } = deps();
    await expect(importIcsUrl(ctx, TRIP_ID, stranger, "https://calendar.example.test/a.ics", value)).rejects.toThrow(AccessDenied);
    await expect(importIcsUrl(ctx, TRIP_ID, { kind: "link", homeZone: "UTC" }, "https://calendar.example.test/a.ics", value)).rejects.toThrow(NotFound);
    expect(fetched).toEqual([]);
  });

  it("passes the guard's refusal through and imports nothing", async () => {
    const { ctx, db } = await testContext({ withItems: false });
    const { value } = deps({
      fetchText: async () => {
        throw new FetchRefused("address");
      },
    });
    await expect(importIcsUrl(ctx, TRIP_ID, kenny, "https://calendar.example.test/a.ics", value)).rejects.toThrow(FetchRefused);
    expect(await db.query.importBatches.findMany()).toEqual([]);
  });
});
