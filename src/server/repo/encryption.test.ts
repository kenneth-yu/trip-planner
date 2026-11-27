import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { present } from "@/testing/present";
import { fixture, TRAVELERS, TRIP_ID } from "@/fixtures/december-trip";
import type { CalendarEvent } from "@/domain/import/calendar-event";
import * as t from "../db/schema";
import type { Db } from "../db/client";
import { sealLegacyRows } from "../crypto/backfill";
import { SealError } from "../crypto/sealed";
import { jacob, kenny, testContext } from "../testing";
import { getTripView, quickAddItem, updateItem } from "../services/trip-service";
import { approveEntry, importCalendarEvents, listInbox, mergeEntry } from "../services/inbox-service";
import { listActivity } from "./activity-repo";
import { loadTripAggregate } from "./trip-repo";

const events: CalendarEvent[] = fixture.calendarEvents;
const SECRETS = ["PLACEHOLDER_A", "PLACEHOLDER_B", "30K", "30C", "QX7Y2Z", "555-0100", "412.50", "DEMO-REF-9", "ZZTOP99", "12A", "212 555 0100"];

function withoutCiphertext(key: string, value: unknown): unknown {
  return key === "sealed" ? "ciphertext" : value;
}

async function storedText(db: Db): Promise<string> {
  const [privates, activity, imported] = await Promise.all([
    db.select().from(t.itemPrivate),
    db.select().from(t.activity),
    db.select().from(t.importedItems),
  ]);
  return JSON.stringify({ privates, activity, imported }, withoutCiphertext);
}

async function everyTableText(db: Db): Promise<string> {
  const tables = await Promise.all([
    db.select().from(t.items),
    db.select().from(t.deadlines),
    db.select().from(t.itemPrivate),
    db.select().from(t.importBatches),
    db.select().from(t.importedItems),
    db.select().from(t.activity),
    db.select().from(t.checkDismissals),
    db.select().from(t.mirrorEvents),
  ]);
  return JSON.stringify(tables, withoutCiphertext);
}

async function exercise() {
  const env = await testContext();
  const { ctx } = env;
  await quickAddItem(
    ctx,
    TRIP_ID,
    kenny,
    {
      type: "plan",
      title: "Peak tram tickets",
      city: "Hong Kong",
      startLocal: "2026-12-05T17:00",
      endLocal: "2026-12-05T18:30",
      confirmationCode: "QX7Y2Z",
      bookingReference: "DEMO-REF-9",
      phone: "555-0100",
      price: { amount: "412.50", currency: "HKD" },
    },
  );
  const view = await getTripView(ctx, TRIP_ID, kenny);
  const nh159 = present(view.items.find((i) => i.flight?.flightNumber === "NH159"));
  await updateItem(ctx, TRIP_ID, nh159.id, kenny, { travelerIds: [TRAVELERS.kenny] });
  await importCalendarEvents(ctx, TRIP_ID, jacob, [events[1]], { source: "google_calendar", label: "Jacob", travelerIds: [TRAVELERS.jacob] });
  const [entry] = await listInbox(ctx, TRIP_ID, kenny);
  await mergeEntry(ctx, TRIP_ID, present(entry).id, kenny);
  await importCalendarEvents(ctx, TRIP_ID, kenny, [events[2]], { source: "ics", label: "file" });
  const [second] = await listInbox(ctx, TRIP_ID, kenny);
  await approveEntry(ctx, TRIP_ID, present(second).id, kenny);
  await importCalendarEvents(
    ctx,
    TRIP_ID,
    jacob,
    [{ ...events[0], description: "Free cancellation until sometime. Confirmation: ZZTOP99 seat 12A. Call +1 212 555 0100." }],
    { source: "google_calendar", label: "Jacob" },
  );
  const first = present((await listInbox(ctx, TRIP_ID, kenny)).find((e) => e.proposed.private.some((p) => p.notes?.includes("Confirmation"))));
  await approveEntry(ctx, TRIP_ID, first.id, kenny);
  await importCalendarEvents(
    ctx,
    TRIP_ID,
    jacob,
    [{ ...events[0], description: "Free cancellation until sometime. Confirmation: ZZTOP99 seat 12A." }],
    { source: "google_calendar", label: "Jacob again" },
  );
  return { ...env, nh159 };
}

describe("sensitive data is sealed at rest", () => {
  it("no code, seat, phone, price or reference appears in item_private, activity or imported_items", async () => {
    const { db } = await exercise();
    const text = await storedText(db);
    for (const secret of SECRETS) expect(text, secret).not.toContain(secret);
    const privates = await db.select().from(t.itemPrivate);
    expect(privates.length).toBeGreaterThan(0);
    for (const row of privates) {
      expect(row.data).toBeNull();
      expect(row.sealed).toMatch(/^k1\./);
    }
    for (const row of await db.select().from(t.activity)) {
      expect([row.before, row.after]).toEqual([null, null]);
      expect(row.sealed).toMatch(/^k1\./);
    }
    for (const row of await db.select().from(t.importedItems)) {
      expect([row.raw, row.proposed]).toEqual([null, null]);
      expect(row.sealed).toMatch(/^k1\./);
    }
  });

  it("no secret appears in any table, including items.notes and deadlines", async () => {
    const { db } = await exercise();
    const text = await everyTableText(db);
    for (const secret of SECRETS) expect(text, secret).not.toContain(secret);
  });

  it("an approved import keeps the whole description as a private note and leaves the shared notes empty", async () => {
    const { ctx } = await exercise();
    const view = await getTripView(ctx, TRIP_ID, kenny);
    const item = present(view.items.find((i) => i.private.some((p) => p.notes?.includes("Free cancellation until sometime"))));
    expect(item.notes).toBe("");
    expect(item.private.map((p) => [p.confirmationCode, p.seat])).toContainEqual(["ZZTOP99", "12A"]);
  });

  it("round trips: the aggregate returns the same private fields that were stored", async () => {
    const { ctx, db } = await exercise();
    const view = await getTripView(ctx, TRIP_ID, kenny);
    const tailor = present(view.items.find((i) => i.title === "Peak tram tickets"));
    expect(tailor.private).toEqual([
      { travelerId: null, confirmationCode: "QX7Y2Z", bookingReference: "DEMO-REF-9", phone: "555-0100", price: { amount: "412.50", currency: "HKD" } },
    ]);
    const nh159 = present(view.items.find((i) => i.flight?.flightNumber === "NH159"));
    expect(nh159.private.map((p) => [p.travelerId, p.seat])).toEqual([
      [TRAVELERS.kenny, "30K"],
      [TRAVELERS.jacob, "30C"],
    ]);
    const aggregate = present(await loadTripAggregate(db, TRIP_ID));
    expect(aggregate.items.find((i) => i.id === nh159.id)?.private).toEqual(nh159.private);
  });

  it("activity snapshots and inbox proposals open back to the original values", async () => {
    const { ctx, db, nh159 } = await exercise();
    const log = await listActivity(db, TRIP_ID);
    const merged = present(log.find((a) => a.action === "merged"));
    expect(merged.itemId).toBe(nh159.id);
    expect(JSON.stringify(merged.after)).toContain("30C");
    expect(merged.before).toMatchObject({ title: "NH159" });
    expect(log.map((a) => a.action)).toContain("created");
    await importCalendarEvents(ctx, TRIP_ID, kenny, [events[3]], { source: "ics", label: "file" });
    const entry = present((await listInbox(ctx, TRIP_ID, kenny)).find((e) => e.proposed.title === "Head spa, Belle Cheveu Hiroo"));
    expect(entry.proposed.type).toBe("plan");
  });

  it("a sealed value cannot be moved to another row", async () => {
    const { ctx, db } = await exercise();
    const [a, b] = await db.select().from(t.itemPrivate);
    await db.update(t.itemPrivate).set({ sealed: present(a).sealed }).where(eq(t.itemPrivate.id, present(b).id));
    await expect(getTripView(ctx, TRIP_ID, kenny)).rejects.toThrow(SealError);
  });
});

describe("legacy rows are sealed on start", () => {
  async function insertLegacy() {
    const env = await testContext();
    const { db, ctx } = env;
    const view = await getTripView(ctx, TRIP_ID, kenny);
    const item = present(view.items[0]);
    const batchId = ctx.newId();
    await db.insert(t.importBatches).values({ id: batchId, tripId: TRIP_ID, userId: kenny.kind === "member" ? kenny.userId : "", source: "ics", label: "old" });
    const proposed = {
      type: "plan" as const,
      title: "Old import",
      start: { at: "2026-12-05T08:00:00.000Z", zone: "Asia/Hong_Kong" },
      end: { at: "2026-12-05T09:00:00.000Z", zone: "Asia/Hong_Kong" },
      startIsEstimated: false,
      endIsEstimated: false,
      location: null,
      travelerIds: [],
      private: [{ travelerId: null, confirmationCode: "LEGACY-CODE" }],
      deadlines: [],
      notes: "",
      status: "confirmed" as const,
      problems: [],
    };
    await db.insert(t.itemPrivate).values({ itemId: item.id, travelerId: null, data: { confirmationCode: "LEGACY-CODE", seat: "LEGACY-SEAT-A" } });
    await db.insert(t.importedItems).values({ batchId, tripId: TRIP_ID, raw: [{ summary: "LEGACY-RAW" }], proposed });
    await db.insert(t.activity).values({
      tripId: TRIP_ID,
      actorId: kenny.kind === "member" ? kenny.userId : "",
      action: "updated",
      itemId: item.id,
      before: { private: [{ seat: "LEGACY-SEAT-A" }] },
      after: { private: [{ seat: "LEGACY-SEAT-B" }] },
    });
    return { ...env, item };
  }

  it("seals every legacy column, nulls it, and projections still read the values", async () => {
    const { db, ctx, item } = await insertLegacy();
    expect(await storedText(db)).toContain("LEGACY-CODE");
    expect(await sealLegacyRows(db)).toEqual({ itemPrivate: 1, activity: 1, imported: 1 });
    const text = await storedText(db);
    for (const secret of ["LEGACY-CODE", "LEGACY-RAW", "LEGACY-SEAT-A", "LEGACY-SEAT-B"]) expect(text, secret).not.toContain(secret);
    const after = present((await getTripView(ctx, TRIP_ID, kenny)).items.find((i) => i.id === item.id));
    expect(after.private.some((p) => p.seat === "LEGACY-SEAT-A" && p.confirmationCode === "LEGACY-CODE")).toBe(true);
    const log = present((await listActivity(db, TRIP_ID)).find((a) => a.action === "updated"));
    expect(log.before).toEqual({ private: [{ seat: "LEGACY-SEAT-A" }] });
    expect(present((await listInbox(ctx, TRIP_ID, kenny))[0]).proposed.title).toBe("Old import");
  });

  it("seals a legacy activity row that has neither before nor after, so the log still lists", async () => {
    const { db } = await insertLegacy();
    await db.insert(t.activity).values({ tripId: TRIP_ID, actorId: kenny.kind === "member" ? kenny.userId : "", action: "viewed", before: null, after: null });
    expect(await sealLegacyRows(db)).toEqual({ itemPrivate: 1, activity: 2, imported: 1 });
    const log = await listActivity(db, TRIP_ID);
    expect(log).toHaveLength(2);
    expect(present(log.find((a) => a.action === "viewed"))).toMatchObject({ before: null, after: null });
    for (const row of await db.select().from(t.activity)) expect(row.sealed).toMatch(/^k1\./);
  });

  it("is idempotent", async () => {
    const { db } = await insertLegacy();
    await sealLegacyRows(db);
    const first = await storedText(db);
    expect(await sealLegacyRows(db)).toEqual({ itemPrivate: 0, activity: 0, imported: 0 });
    expect(await storedText(db)).toBe(first);
  });
});
