import { describe, expect, it } from "vitest";
import { present } from "@/testing/present";
import { fixture, TRIP_ID } from "@/fixtures/december-trip";
import type { CalendarEvent } from "@/domain/import/calendar-event";
import * as t from "../db/schema";
import type { Db } from "../db/client";
import { jacob, kenny, testContext } from "../testing";
import { approveEntry, importCalendarEvents, listInbox, mergeEntry } from "./inbox-service";
import { getTripView } from "./trip-service";

function hideCiphertext(_key: string, value: unknown): unknown {
  return typeof value === "string" && value.startsWith("k1.") ? "ciphertext" : value;
}

async function everyTableText(db: Db): Promise<string> {
  const tables = await Promise.all([
    db.select().from(t.items),
    db.select().from(t.deadlines),
    db.select().from(t.itemPrivate),
    db.select().from(t.importBatches),
    db.select().from(t.importedItems),
    db.select().from(t.activity),
    db.select().from(t.mirrorEvents),
  ]);
  return JSON.stringify(tables, hideCiphertext);
}

async function importAndApproveAll(event: CalendarEvent) {
  const env = await testContext();
  await importCalendarEvents(env.ctx, TRIP_ID, kenny, [event], { source: "google_calendar", label: "k" });
  for (const entry of await listInbox(env.ctx, TRIP_ID, kenny)) await approveEntry(env.ctx, TRIP_ID, entry.id, kenny);
  return env;
}

const flight = fixture.calendarEvents[0];
const hotel = fixture.calendarEvents[2];

const wordings: [string, string, string][] = [
  ["code introduced with 'is'", "Your confirmation code is GAPCODE1 thanks", "GAPCODE1"],
  ["hyphenated code", "Confirmation: ABC-GAP22", "ABC-GAP22"],
  ["booking id", "Booking ID: GAPID77X", "GAPID77X"],
  ["itinerary number", "Itinerary no. GAPITIN88", "GAPITIN88"],
  ["several seats", "Seats 12A and 12B", "12B"],
  ["parenthesised phone", "Call (415) 555-0123", "555-0123"],
  ["international phone", "Hotel tel +81 3 5555 0199", "5555 0199"],
  ["amount with trailing currency", "Total 45,000 JPY", "45,000"],
];

describe("imported free text never reaches a plaintext column", () => {
  for (const [name, description, secret] of wordings) {
    it(`${name} is stored only sealed and reaches editors as a private note`, async () => {
      const { ctx, db } = await importAndApproveAll({ ...flight, description });
      expect(await everyTableText(db)).not.toContain(secret);
      const view = await getTripView(ctx, TRIP_ID, kenny);
      const item = present(view.items.find((i) => i.flight?.flightNumber === "NH159" && i.private.some((p) => p.notes?.includes(secret))));
      expect(item.notes).not.toContain(secret);
    });
  }

  it("the sentence after a deadline, with its code and phone, is stored only sealed", async () => {
    const { db } = await importAndApproveAll({
      ...hotel,
      description: "Free cancellation until Sat Nov 28, 11:59pm. After that, call 03-1234-5678 and quote confirmation SECRETQ9.",
    });
    const text = await everyTableText(db);
    expect(text).not.toContain("SECRETQ9");
    expect(text).not.toContain("1234-5678");
  });

  it("merging a second description into an item stores nothing in plaintext", async () => {
    const { ctx, db } = await importAndApproveAll(flight);
    await importCalendarEvents(ctx, TRIP_ID, jacob, [{ ...flight, description: "Reservation MERGEC12 seat 31K. Free cancellation until sometime." }], {
      source: "google_calendar",
      label: "j",
    });
    for (const entry of await listInbox(ctx, TRIP_ID, kenny)) if (entry.match) await mergeEntry(ctx, TRIP_ID, entry.id, kenny, { keep: {} });
    const text = await everyTableText(db);
    expect(text).not.toContain("MERGEC12");
    expect(text).not.toContain("31K");
  });

  it("the inbox still shows the sentences it could not read", async () => {
    const { ctx } = await testContext();
    await importCalendarEvents(ctx, TRIP_ID, kenny, [{ ...flight, description: "Free cancellation until sometime." }], { source: "google_calendar", label: "k" });
    const entries = await listInbox(ctx, TRIP_ID, kenny);
    expect(entries.flatMap((e) => e.unparsed)).toContain("Free cancellation until sometime.");
  });
});
