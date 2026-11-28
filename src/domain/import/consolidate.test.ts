import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { fixture } from "@/fixtures/december-trip";
import { present } from "@/testing/present";
import { fromLocal } from "../time/format";
import type { Zone } from "../types";
import type { CalendarEvent } from "./calendar-event";
import { mapCalendarEvent } from "./calendar-event";
import { consolidate, matchRecords, Memo, mergeDifference, mergeRecords, sharedDifferences, type Cluster } from "./matching";
import { planCalendarImport } from "./pipeline";
import type { ProposedItem } from "./proposal";

const ctx = { homeZone: "America/New_York", travelerIds: [] };
const events: CalendarEvent[] = fixture.calendarEvents;
const template = (summary: string) => mapCalendarEvent(present(events.find((e) => e.summary?.startsWith(summary)), summary), ctx).proposed;
const PLAN = template("Head spa");
const FLIGHT = template("NH159");
const STAY = template("Hotel Resol Ueno");

function everyCluster(records: ProposedItem[]): Cluster[] {
  const clusters: Cluster[] = [];
  records.forEach((rec, i) => {
    const target = clusters.find((c) => matchRecords(c.proposed, rec)?.strength === "strong");
    if (!target) {
      clusters.push({ proposed: structuredClone(rec), sources: [i], differences: [] });
      return;
    }
    for (const d of sharedDifferences(target.proposed, rec)) {
      const known = target.differences.find((x) => x.field === d.field);
      if (known) mergeDifference(known, d);
      else target.differences.push(d);
    }
    const merged = mergeRecords(target.proposed, rec, [], {});
    merged.problems = [...new Set([...target.proposed.problems, ...rec.problems])];
    merged.status = target.proposed.status === "confirmed" || rec.status === "confirmed" ? "confirmed" : "needs_review";
    if (!target.proposed.flight?.airline && rec.flight?.airline && merged.flight) merged.flight.airline = rec.flight.airline;
    target.proposed = merged;
    target.sources.push(i);
  });
  return clusters;
}

const zones: Zone[] = ["Asia/Tokyo", "America/New_York", "America/Los_Angeles", "Pacific/Kiritimati", "Pacific/Pago_Pago", "Europe/London", "Asia/Kolkata", "Australia/Lord_Howe"];
const titles = ["Dinner at Gonpachi", "Dinner at Gonpachi Nishiazabu", "Ichiran Shinjuku", "Ichiran", "Hotel Resol Ueno (Tokyo)", "Resol Ueno", "Museum", "Museum of Art", "Tea ceremony"];
const day = fc.constantFrom("2026-12-02", "2026-12-03", "2026-12-04");
const clock = fc.constantFrom("00:30:00", "01:00:00", "08:00:00", "08:30:00", "10:00:00", "19:30:00", "23:30:00");
const hours = fc.constantFrom(1, 2, 3);
const flightNumbers = fc.constantFrom("NH159", "NH 159", "CX509", "NH160");

const record: fc.Arbitrary<ProposedItem> = fc.tuple(fc.constantFrom(PLAN, FLIGHT, STAY), fc.constantFrom(...titles), flightNumbers, fc.constantFrom(...zones), day, clock, hours).map(([base, title, number, zone, d, c, h]) => {
  const start = fromLocal(`${d}T${c}`, zone);
  const end = { at: new Date(Date.parse(start.at) + h * 3600_000).toISOString(), zone };
  const flight = base.flight ? { ...base.flight, flightNumber: number } : base.flight;
  return { ...structuredClone(base), title: base.type === "flight" ? number : title, start, end, flight };
});

const importContext = { calendarTravelers: {}, defaultTravelerIds: [], homeZone: "America/New_York" };

describe("consolidating an import", () => {
  it("gives the same clusters as comparing every record with every cluster, across named zones where the local day is not the UTC day", () => {
    fc.assert(
      fc.property(fc.array(record, { maxLength: 40 }), (records) => {
        expect(consolidate(records)).toEqual(everyCluster(records));
      }),
      { numRuns: 200 },
    );
  });

  it("the zones in the property really do put the local day on the other side of the UTC day", () => {
    const start = fromLocal("2026-12-03T00:30:00", "Pacific/Kiritimati");
    expect(new Date(start.at).getUTCDate()).toBe(2);
    expect(fromLocal("2026-12-03T23:30:00", "Pacific/Pago_Pago").at.slice(0, 10)).toBe("2026-12-04");
  });

  it("plans at 00:30 and at 23:30 on the same Kiritimati date are different days, and two copies of the early one merge", () => {
    const early = { ...structuredClone(PLAN), title: "Dinner at Gonpachi", start: fromLocal("2026-12-03T00:30:00", "Pacific/Kiritimati"), end: fromLocal("2026-12-03T02:00:00", "Pacific/Kiritimati") };
    const same = { ...structuredClone(early) };
    const otherDay = { ...structuredClone(early), start: fromLocal("2026-12-03T23:30:00", "Pacific/Kiritimati"), end: fromLocal("2026-12-04T01:00:00", "Pacific/Kiritimati") };
    expect(consolidate([early, same])).toHaveLength(1);
    expect(consolidate([early, otherDay])).toHaveLength(2);
  });

  it("each call has its own memory: nothing from one import is kept for the next", () => {
    const a = new Memo();
    const b = new Memo();
    expect(a.words("Dinner at Gonpachi")).toEqual(b.words("Dinner at Gonpachi"));
    expect(a.words("Dinner at Gonpachi")).not.toBe(b.words("Dinner at Gonpachi"));
  });

  it("500 events at the very same moment are all kept apart", () => {
    const many: CalendarEvent[] = Array.from({ length: 500 }, (_, i) => ({ summary: `Event ${i}`, start: { dateTime: "2026-12-05T10:00:00Z" }, end: { dateTime: "2026-12-05T11:00:00Z" } }));
    expect(planCalendarImport(many, [], importContext)).toHaveLength(500);
  });

  it("events that really are the same thing are still merged among many others", () => {
    const among: CalendarEvent[] = [
      ...Array.from({ length: 200 }, (_, i) => ({ summary: `Event ${i}`, start: { dateTime: "2026-12-05T10:00:00Z" }, end: { dateTime: "2026-12-05T11:00:00Z" } })),
      { summary: "Dinner at Gonpachi", start: { dateTime: "2026-12-05T19:00:00Z" }, end: { dateTime: "2026-12-05T21:00:00Z" } },
      { summary: "Dinner at Gonpachi", start: { dateTime: "2026-12-05T19:00:00Z" }, end: { dateTime: "2026-12-05T21:00:00Z" } },
    ];
    expect(planCalendarImport(among, [], importContext)).toHaveLength(201);
  });
});
