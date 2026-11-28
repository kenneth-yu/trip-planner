import fc from "fast-check";
import { describe, expect, it } from "vitest";
import type { CalendarEvent } from "./calendar-event";
import { mapCalendarEvent } from "./calendar-event";
import { consolidate, matchRecords, mergeDifference, mergeRecords, sharedDifferences, type Cluster } from "./matching";
import { planCalendarImport } from "./pipeline";
import type { ProposedItem } from "./proposal";

const ctx = { homeZone: "America/New_York", travelerIds: [] };

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

const titles = ["Dinner at Gonpachi", "Dinner at Gonpachi Nishiazabu", "Ichiran Shinjuku", "Ichiran", "Hotel Resol Ueno (Tokyo)", "Resol Ueno", "NH159 JFK → HND", "NH 159", "CX509 NRT → HKG", "Museum", "Museum of Art", "Tea ceremony"];
const day = fc.constantFrom("2026-12-02", "2026-12-03", "2026-12-04");
const clock = fc.constantFrom("08:00:00", "08:30:00", "09:00:00", "10:00:00", "19:30:00");
const hours = fc.constantFrom(1, 2, 3);

const event: fc.Arbitrary<CalendarEvent> = fc
  .tuple(fc.constantFrom(...titles), day, clock, hours, fc.constantFrom("+09:00", "Z"), fc.boolean())
  .map(([summary, d, c, h, offset, allDay]) => {
    const start = `${d}T${c}${offset}`;
    const end = new Date(Date.parse(start) + h * 3600_000).toISOString();
    return allDay ? { summary, start: { date: d }, end: { date: "2026-12-05" } } : { summary, start: { dateTime: start }, end: { dateTime: end } };
  });

const importContext = { calendarTravelers: {}, defaultTravelerIds: [], homeZone: "America/New_York" };

describe("consolidating an import", () => {
  it("gives the same clusters as comparing every record with every cluster", () => {
    fc.assert(
      fc.property(fc.array(event, { maxLength: 40 }), (events) => {
        const records = events.map((e) => mapCalendarEvent(e, ctx).proposed);
        expect(consolidate(records)).toEqual(everyCluster(records));
      }),
      { numRuns: 150 },
    );
  });

  it("a calendar of 500 events at the very same moment is planned in well under the time it used to take", () => {
    const events: CalendarEvent[] = Array.from({ length: 500 }, (_, i) => ({ summary: `Event ${i}`, start: { dateTime: "2026-12-05T10:00:00Z" }, end: { dateTime: "2026-12-05T11:00:00Z" } }));
    const began = performance.now();
    const drafts = planCalendarImport(events, [], importContext);
    expect(drafts).toHaveLength(500);
    expect(performance.now() - began).toBeLessThan(1500);
  });

  it("events that really are the same thing are still merged among many others", () => {
    const events: CalendarEvent[] = [
      ...Array.from({ length: 200 }, (_, i) => ({ summary: `Event ${i}`, start: { dateTime: "2026-12-05T10:00:00Z" }, end: { dateTime: "2026-12-05T11:00:00Z" } })),
      { summary: "Dinner at Gonpachi", start: { dateTime: "2026-12-05T19:00:00Z" }, end: { dateTime: "2026-12-05T21:00:00Z" } },
      { summary: "Dinner at Gonpachi", start: { dateTime: "2026-12-05T19:00:00Z" }, end: { dateTime: "2026-12-05T21:00:00Z" } },
    ];
    expect(planCalendarImport(events, [], importContext)).toHaveLength(201);
  });
});
