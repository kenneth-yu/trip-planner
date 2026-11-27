import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { present } from "@/testing/present";
import { fixture, TRAVELERS, TRIP_ID } from "@/fixtures/december-trip";
import type { CalendarEvent } from "@/domain/import/calendar-event";
import * as t from "../db/schema";
import { kenny, testContext } from "../testing";
import { approveAllClean, approveEntry, importCalendarEvents, listInbox, mergeEntry } from "./inbox-service";
import { getTripView } from "./trip-service";

const race = vi.hoisted(() => ({ failBeforeSave: 0 }));

vi.mock("../repo/trip-repo", async (original) => {
  const real = await original<typeof import("../repo/trip-repo")>();
  return {
    ...real,
    saveItem: async (db: Parameters<typeof real.saveItem>[0], item: Parameters<typeof real.saveItem>[1]) => {
      if (race.failBeforeSave > 0) {
        race.failBeforeSave -= 1;
        throw new real.UnknownTraveler();
      }
      return real.saveItem(db, item);
    },
  };
});

const events: CalendarEvent[] = fixture.calendarEvents;
const both = [TRAVELERS.kenny, TRAVELERS.jacob];

describe("the save refuses a traveler that was removed after the entry was read", () => {
  const remove = (env: Awaited<ReturnType<typeof testContext>>) => env.db.delete(t.travelers).where(eq(t.travelers.id, TRAVELERS.jacob));
  beforeEach(() => {
    race.failBeforeSave = 0;
  });

  it("Add saves the item without them instead of failing", async () => {
    const env = await testContext({ withItems: false });
    await importCalendarEvents(env.ctx, TRIP_ID, kenny, [events[2]], { source: "ics", label: "file", travelerIds: both });
    const [entry] = await listInbox(env.ctx, TRIP_ID, kenny);
    await remove(env);
    race.failBeforeSave = 1;
    const saved = await approveEntry(env.ctx, TRIP_ID, entry.id, kenny);
    expect(saved.withoutRemovedTraveler).toBe(true);
    expect(present((await getTripView(env.ctx, TRIP_ID, kenny)).items[0]).travelerIds).toEqual([TRAVELERS.kenny]);
    expect(await listInbox(env.ctx, TRIP_ID, kenny)).toEqual([]);
  });

  it("Merge saves the merged item without them instead of failing", async () => {
    const env = await testContext({ withItems: false });
    await importCalendarEvents(env.ctx, TRIP_ID, kenny, [events[2]], { source: "ics", label: "file", travelerIds: [TRAVELERS.kenny] });
    await approveEntry(env.ctx, TRIP_ID, (await listInbox(env.ctx, TRIP_ID, kenny))[0].id, kenny);
    await importCalendarEvents(env.ctx, TRIP_ID, kenny, [events[2]], { source: "ics", label: "again", travelerIds: both });
    const [again] = await listInbox(env.ctx, TRIP_ID, kenny);
    await remove(env);
    race.failBeforeSave = 1;
    const saved = await mergeEntry(env.ctx, TRIP_ID, again.id, kenny);
    expect(saved.withoutRemovedTraveler).toBe(true);
    expect(present((await getTripView(env.ctx, TRIP_ID, kenny)).items[0]).travelerIds).toEqual([TRAVELERS.kenny]);
  });

  it("Add all is not aborted by it and still adds every entry", async () => {
    const env = await testContext({ withItems: false });
    await importCalendarEvents(env.ctx, TRIP_ID, kenny, [events[2], events[6], events[8]], { source: "ics", label: "file", travelerIds: both });
    let removed = false;
    const ctx = {
      ...env.ctx,
      onTripChanged: async () => {
        if (removed) return;
        removed = true;
        await remove(env);
        race.failBeforeSave = 1;
      },
    };
    const result = await approveAllClean(ctx, TRIP_ID, kenny);
    expect(result).toMatchObject({ added: 3, needYou: 0, alreadyDecided: 0 });
    expect(result.withoutRemovedTraveler).toBe(2);
    expect(await listInbox(env.ctx, TRIP_ID, kenny)).toEqual([]);
  });
});
