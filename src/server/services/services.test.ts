import { present } from "@/testing/present";
import { describe, expect, it } from "vitest";
import { fixture, TRAVELERS, TRIP_ID } from "@/fixtures/december-trip";
import { AccessDenied } from "@/domain/visibility/project";
import { runChecks } from "@/domain/checks/checks";
import type { CalendarEvent } from "@/domain/import/calendar-event";
import { toLocal } from "@/domain/time/format";
import * as t from "../db/schema";
import { jacob, kenny, testContext } from "../testing";
import { getTripView, quickAddItem, removeItem, updateItem } from "./trip-service";
import { approveAllClean, approveEntry, disagreementFindings, discardEntry, importCalendarEvents, listInbox, mergeEntry, NeedsDecision } from "./inbox-service";

const calendars = {
  "kenny primary": [TRAVELERS.kenny],
  "kenny primary (from Gmail)": [TRAVELERS.kenny],
  "shared China": [TRAVELERS.kenny, TRAVELERS.jacob],
};
const events: CalendarEvent[] = fixture.calendarEvents;

describe("trip service on a real database", () => {
  it("round trips the fixture: stored instants and zones come back unchanged", async () => {
    const { ctx } = await testContext();
    const view = await getTripView(ctx, TRIP_ID, kenny);
    const nh160 = present(view.items.find((i) => i.flight?.flightNumber === "NH160"));
    expect(toLocal(nh160.end).toFormat("yyyy-MM-dd HH:mm")).toBe("2026-12-15 21:55");
    expect(nh160.end.zone).toBe("America/New_York");
  });

  it("quick add stores the item, logs activity and signals the change", async () => {
    const { ctx, db, changed } = await testContext({ withItems: false });
    const item = await quickAddItem(ctx, TRIP_ID, jacob, {
      type: "plan", title: "Jantzen Tailor", city: "Hong Kong", startLocal: "2026-12-05T17:00", endLocal: "2026-12-05T18:30",
    });
    expect((await getTripView(ctx, TRIP_ID, kenny)).items.map((i) => i.id)).toEqual([item.id]);
    expect((await db.select().from(t.activity)).map((a) => a.action)).toEqual(["created"]);
    expect(changed).toEqual([TRIP_ID]);
  });

  it("only the creator changes who can see an item, and hidden items cannot be edited by others", async () => {
    const { ctx } = await testContext({ withItems: false });
    const secret = await quickAddItem(ctx, TRIP_ID, jacob, { type: "plan", title: "Ring shopping", city: "Hong Kong", startLocal: "2026-12-05T20:00", endLocal: "2026-12-05T21:00" }, { visibility: "only_me" });
    await expect(updateItem(ctx, TRIP_ID, secret.id, kenny, { title: "Found it" })).rejects.toThrow(AccessDenied);
    await expect(removeItem(ctx, TRIP_ID, secret.id, kenny)).rejects.toThrow(AccessDenied);
    const shared = await quickAddItem(ctx, TRIP_ID, jacob, { type: "plan", title: "Dinner", city: "Hong Kong", startLocal: "2026-12-05T19:00", endLocal: "2026-12-05T20:00" });
    await expect(updateItem(ctx, TRIP_ID, shared.id, kenny, { visibility: "only_me" })).rejects.toThrow(/Only the person who added this/);
  });
});

describe("review inbox (phase 2 acceptance on a real database)", () => {
  it("importing changes nothing on the trip until someone approves", async () => {
    const { ctx, changed } = await testContext();
    const before = await getTripView(ctx, TRIP_ID, kenny);
    await importCalendarEvents(ctx, TRIP_ID, kenny, events, { source: "google_calendar", label: "Two calendars", calendarTravelers: calendars });
    expect(await getTripView(ctx, TRIP_ID, kenny)).toEqual(before);
    expect(changed).toEqual([]);
  });

  it("into an empty trip: NH159 merged, CX509 waits for a choice, clean items go in with one action", async () => {
    const { ctx } = await testContext({ withItems: false });
    await importCalendarEvents(ctx, TRIP_ID, kenny, events, { source: "google_calendar", label: "Two calendars", calendarTravelers: calendars });
    const inbox = await listInbox(ctx, TRIP_ID, kenny);
    const nh159 = present(inbox.find((e) => e.proposed.title === "NH159"));
    expect(nh159.proposed.private.map((p) => p.seat)).toEqual(["30K", "30C"]);
    const cx509 = present(inbox.find((e) => e.proposed.title === "CX509"));
    await expect(approveEntry(ctx, TRIP_ID, cx509.id, kenny)).rejects.toThrow(NeedsDecision);
    expect((await disagreementFindings(ctx, TRIP_ID, kenny)).map((f) => f.sentence)).toEqual(["Two records for CX509 disagree on departure: 9:00am and 8:50am."]);

    const added = await approveAllClean(ctx, TRIP_ID, kenny);
    expect(added).toBeGreaterThan(5);
    await approveEntry(ctx, TRIP_ID, cx509.id, kenny, { choices: { start: 1 } });
    const view = await getTripView(ctx, TRIP_ID, kenny);
    const flight = present(view.items.find((i) => i.flight?.flightNumber === "CX509"));
    expect(toLocal(flight.start).toFormat("HH:mm")).toBe("08:50");
    expect(await disagreementFindings(ctx, TRIP_ID, kenny)).toEqual([]);
  });

  it("the $1,183.22 stay is only a possible match for the Airbnb and is never added in bulk", async () => {
    const { ctx } = await testContext();
    const existing = present((await getTripView(ctx, TRIP_ID, kenny)).items.find((i) => i.title.startsWith("Stay at Total")));
    await removeItem(ctx, TRIP_ID, existing.id, kenny);
    await importCalendarEvents(ctx, TRIP_ID, kenny, events, { source: "google_calendar", label: "Two calendars", calendarTravelers: calendars });
    const total = present((await listInbox(ctx, TRIP_ID, kenny)).find((e) => e.proposed.title.startsWith("Stay at Total")));
    expect(total.match?.strength).toBe("possible");
    expect(total.clean).toBe(false);
    await expect(approveAllClean(ctx, TRIP_ID, kenny)).resolves.toBe(0);
  });

  it("merging a re-imported NH159 adds Jacob's seat without touching Kenny's", async () => {
    const { ctx } = await testContext();
    const view = await getTripView(ctx, TRIP_ID, kenny);
    const nh159 = present(view.items.find((i) => i.flight?.flightNumber === "NH159"));
    await updateItem(ctx, TRIP_ID, nh159.id, kenny, { travelerIds: [TRAVELERS.kenny] });
    await importCalendarEvents(ctx, TRIP_ID, jacob, [events[1]], { source: "google_calendar", label: "Jacob", travelerIds: [TRAVELERS.jacob] });
    const entry = (await listInbox(ctx, TRIP_ID, kenny))[0];
    expect(entry.match).toMatchObject({ itemId: nh159.id, strength: "strong", differences: [] });
    await mergeEntry(ctx, TRIP_ID, entry.id, kenny);
    const after = present((await getTripView(ctx, TRIP_ID, kenny)).items.find((i) => i.id === nh159.id));
    expect(after.travelerIds).toEqual([TRAVELERS.kenny, TRAVELERS.jacob]);
    expect(after.private.map((p) => [p.travelerId, p.seat])).toEqual([
      [TRAVELERS.kenny, "30K"],
      [TRAVELERS.jacob, "30C"],
    ]);
  });

  it("merging a conflicting time needs an explicit keep, then applies it", async () => {
    const { ctx } = await testContext();
    await importCalendarEvents(ctx, TRIP_ID, kenny, [events[4]], { source: "google_calendar", label: "Gmail", travelerIds: [TRAVELERS.kenny] });
    const entry = (await listInbox(ctx, TRIP_ID, kenny))[0];
    expect(entry.match?.differences.map((d) => d.values)).toEqual([["8:50am", "9:00am"]]);
    await expect(mergeEntry(ctx, TRIP_ID, entry.id, kenny)).rejects.toThrow(NeedsDecision);
    await mergeEntry(ctx, TRIP_ID, entry.id, kenny, { keep: { start: 0 } });
    const flight = present((await getTripView(ctx, TRIP_ID, kenny)).items.find((i) => i.flight?.flightNumber === "CX509"));
    expect(toLocal(flight.start).toFormat("HH:mm")).toBe("08:50");
  });

  it("discarded entries leave the inbox and viewers cannot see the inbox at all", async () => {
    const { ctx, db } = await testContext();
    await importCalendarEvents(ctx, TRIP_ID, kenny, [events[0]], { source: "ics", label: "file" });
    const [entry] = await listInbox(ctx, TRIP_ID, kenny);
    await discardEntry(ctx, TRIP_ID, entry.id, kenny);
    expect(await listInbox(ctx, TRIP_ID, kenny)).toEqual([]);
    await db.update(t.memberships).set({ role: "viewer" }).where((await import("drizzle-orm")).eq(t.memberships.userId, jacob.kind === "member" ? jacob.userId : ""));
    await expect(listInbox(ctx, TRIP_ID, jacob)).rejects.toThrow(AccessDenied);
    expect(await disagreementFindings(ctx, TRIP_ID, jacob)).toEqual([]);
  });
});

describe("deciding an entry twice", () => {
  it("only the first decision wins", async () => {
    const { ctx } = await testContext({ withItems: false });
    await importCalendarEvents(ctx, TRIP_ID, kenny, [events[2]], { source: "ics", label: "file" });
    const [entry] = await listInbox(ctx, TRIP_ID, kenny);
    await approveEntry(ctx, TRIP_ID, entry.id, kenny);
    await expect(approveEntry(ctx, TRIP_ID, entry.id, jacob)).rejects.toThrow(/already have been handled/);
    expect((await getTripView(ctx, TRIP_ID, kenny)).items).toHaveLength(1);
  });
});

describe("checks with the inbox", () => {
  it("records that disagree show up in checks until resolved", async () => {
    const { ctx } = await testContext();
    await importCalendarEvents(ctx, TRIP_ID, kenny, [events[4]], { source: "google_calendar", label: "Gmail", travelerIds: [TRAVELERS.kenny] });
    const view = await getTripView(ctx, TRIP_ID, kenny);
    const sentences = runChecks(view, { extra: await disagreementFindings(ctx, TRIP_ID, kenny) }).map((f) => f.sentence);
    expect(sentences).toContain("Two records for CX509 disagree on departure: 8:50am and 9:00am.");
  });
});

describe("seeding", () => {
  it("adds every demo trip once and skips them on a second run", async () => {
    const { createPgliteDb } = await import("../db/client");
    const { seedEverything } = await import("../seed");
    const db = await createPgliteDb();
    const first = await seedEverything(db);
    expect(first.created).toEqual(["Asia, December 2026", "Lisbon, someday", "Chicago weekend", "Tokyo and Kyoto with friends"]);
    const second = await seedEverything(db);
    expect(second.created).toEqual([]);
    expect(second.skipped).toHaveLength(4);
  });
});
