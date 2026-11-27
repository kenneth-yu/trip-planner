import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { DATE_LINE_ZONES, DST_ZONES, HALF_HOUR_ZONES, PLAN_ZONES, fcParams, instantMsArb, isoOf } from "@/testing/arbitraries";
import { present } from "@/testing/present";
import type { Item, Requester, TripAggregate, Zone, ZonedTime } from "../types";
import { projectTrip } from "../visibility/project";
import { buildDays } from "./days";
import { formatFlightDuration, fromLocal, instantMs, localDateKey, offsetAt, toLocal } from "./format";

const MINUTE = 60_000;
const HOUR = 3_600_000;
const LOCAL_FORMAT = "yyyy-MM-dd'T'HH:mm";
const ALL_ZONES = [...new Set([...PLAN_ZONES, ...DST_ZONES, ...DATE_LINE_ZONES, ...HALF_HOUR_ZONES])];

function transitions(zone: Zone): number[] {
  const out: number[] = [];
  const from = Date.UTC(2026, 0, 1);
  const to = Date.UTC(2028, 0, 1);
  let previous = offsetAt(zone, isoOf(from));
  for (let t = from + HOUR; t < to; t += HOUR) {
    const current = offsetAt(zone, isoOf(t));
    if (current !== previous) out.push(t);
    previous = current;
  }
  return out;
}

const TRANSITIONS = new Map(DST_ZONES.map((z) => [z, transitions(z)] as const));

const nearTransition = fc
  .constantFrom(...DST_ZONES)
  .chain((zone) =>
    fc.tuple(fc.constantFrom(...present(TRANSITIONS.get(zone)).filter((t) => t > Date.UTC(2026, 10, 1))), fc.integer({ min: -180, max: 180 })).map(([t, minutes]): ZonedTime => ({ at: isoOf(t + minutes * MINUTE), zone })),
  );

const anywhere = fc.tuple(instantMsArb, fc.constantFrom(...ALL_ZONES)).map(([ms, zone]): ZonedTime => ({ at: isoOf(ms), zone }));
const anyZoned = fc.oneof(nearTransition, anywhere);

const parts = (t: ZonedTime) => {
  const fields = Object.fromEntries(
    new Intl.DateTimeFormat("en-GB", { timeZone: t.zone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" })
      .formatToParts(new Date(t.at))
      .map((p) => [p.type, p.value]),
  );
  return { date: `${fields.year}-${fields.month}-${fields.day}`, local: `${fields.year}-${fields.month}-${fields.day}T${fields.hour}:${fields.minute}` };
};

describe("time properties", () => {
  it("the local date and wall clock of an instant agree with the platform's time zone database", () => {
    fc.assert(
      fc.property(anyZoned, (t) => {
        expect(localDateKey(t)).toBe(parts(t).date);
        expect(toLocal(t).toFormat(LOCAL_FORMAT)).toBe(parts(t).local);
      }),
      fcParams(500),
    );
  });

  it("fromLocal returns an instant that shows the same wall clock, within an hour of the original, and exactly it outside repeated hours", () => {
    fc.assert(
      fc.property(anyZoned, (t) => {
        const local = toLocal(t).toFormat(LOCAL_FORMAT);
        const back = fromLocal(local, t.zone);
        expect(back.zone).toBe(t.zone);
        expect(toLocal(back).toFormat(LOCAL_FORMAT)).toBe(local);
        const wholeMinute = instantMs(t) - (instantMs(t) % MINUTE);
        expect(Math.abs(instantMs(back) - wholeMinute)).toBeLessThanOrEqual(HOUR);
        const repeated = offsetAt(t.zone, isoOf(wholeMinute - 2 * HOUR)) !== offsetAt(t.zone, isoOf(wholeMinute + 2 * HOUR));
        if (!repeated) expect(instantMs(back)).toBe(wholeMinute);
      }),
      fcParams(500),
    );
  });

  it("later wall clock times never map to earlier instants, even across skipped hours", () => {
    fc.assert(
      fc.property(nearTransition, fc.integer({ min: 1, max: 240 }), (t, step) => {
        const earlierLocal = toLocal(t).toFormat(LOCAL_FORMAT);
        const laterLocal = new Date(Date.parse(`${earlierLocal}:00Z`) + step * MINUTE).toISOString().slice(0, 16);
        const earlier = fromLocal(earlierLocal, t.zone);
        const later = fromLocal(laterLocal, t.zone);
        expect(instantMs(later)).toBeGreaterThanOrEqual(instantMs(earlier));
      }),
      fcParams(500),
    );
  });

  it("flight durations equal the difference of the UTC instants, whatever the zones on each end", () => {
    fc.assert(
      fc.property(anyZoned, fc.constantFrom(...ALL_ZONES), fc.integer({ min: 1, max: 24 * 60 }), (start, endZone, minutes) => {
        const end: ZonedTime = { at: isoOf(instantMs(start) + minutes * MINUTE), zone: endZone };
        const expected = `${Math.floor(minutes / 60) > 0 ? `${Math.floor(minutes / 60)}h ` : ""}${minutes % 60}m`;
        expect(formatFlightDuration(start, end)).toBe(expected);
        expect(Date.parse(end.at) - Date.parse(start.at)).toBe(minutes * MINUTE);
      }),
      fcParams(500),
    );
  });

  it("half hour and quarter hour zones keep minutes on the wall clock", () => {
    fc.assert(
      fc.property(fc.constantFrom(...HALF_HOUR_ZONES), instantMsArb, (zone, ms) => {
        const t: ZonedTime = { at: isoOf(ms), zone };
        expect(toLocal(t).toFormat(LOCAL_FORMAT)).toBe(parts(t).local);
        expect(Math.abs(offsetAt(zone, t.at) % 15)).toBe(0);
      }),
      fcParams(300),
    );
  });
});

const owner: Requester = { kind: "member", userId: "00000000-0000-4000-8100-000000000001", homeZone: "America/New_York" };

function tripOf(items: Item[]): TripAggregate {
  return {
    trip: { id: "00000000-0000-4000-8300-000000000009", name: "Time trip", ownerId: owner.kind === "member" ? owner.userId : "", viewersSeeDeadlines: false, createdAt: "2026-11-01T00:00:00.000Z", updatedAt: "2026-11-01T00:00:00.000Z" },
    memberships: [{ tripId: "00000000-0000-4000-8300-000000000009", userId: owner.kind === "member" ? owner.userId : "", role: "owner" }],
    travelers: [],
    items,
    shareLink: null,
  };
}

function itemAt(id: string, type: Item["type"], start: ZonedTime, end: ZonedTime, extra: Partial<Item> = {}): Item {
  return {
    id,
    tripId: "00000000-0000-4000-8300-000000000009",
    type,
    title: "Item",
    start,
    end,
    startIsEstimated: false,
    endIsEstimated: false,
    location: { city: "Tokyo" },
    travelerIds: [],
    visibility: "everyone",
    visibleToUserIds: [],
    showAsBusy: false,
    status: "confirmed",
    notes: "",
    flags: [],
    private: [],
    deadlines: [],
    createdBy: owner.kind === "member" ? owner.userId : "",
    updatedBy: owner.kind === "member" ? owner.userId : "",
    createdAt: "2026-11-20T12:00:00.000Z",
    updatedAt: "2026-11-20T12:00:00.000Z",
    ...extra,
  };
}

describe("day bucketing properties", () => {
  it("a plan lands on the local date where it happens, in any zone and across DST changes", () => {
    fc.assert(
      fc.property(anyZoned, fc.integer({ min: 1, max: 600 }), (start, minutes) => {
        const end: ZonedTime = { at: isoOf(instantMs(start) + minutes * MINUTE), zone: start.zone };
        const view = projectTrip(tripOf([itemAt("00000000-0000-4000-8400-000000000001", "plan", start, end)]), owner);
        const days = buildDays(view);
        const day = present(days.find((d) => d.entries.some((e) => e.kind === "event")));
        expect(day.key).toBe(parts(start).date);
      }),
      fcParams(400),
    );
  });

  it("a flight departs on its local start date and lands on its local end date, including across the date line", () => {
    const flightZones = fc.constantFrom(...DATE_LINE_ZONES, "America/Los_Angeles", "Asia/Tokyo", "America/New_York");
    fc.assert(
      fc.property(instantMsArb, flightZones, flightZones, fc.integer({ min: 30, max: 22 * 60 }), (ms, fromZone, toZone, minutes) => {
        const start: ZonedTime = { at: isoOf(ms), zone: fromZone };
        const end: ZonedTime = { at: isoOf(ms + minutes * MINUTE), zone: toZone };
        const flight = itemAt("00000000-0000-4000-8400-000000000002", "flight", start, end, { location: null, flight: { flightNumber: "XX1", fromAirport: "JFK", toAirport: "HND" } });
        const days = buildDays(projectTrip(tripOf([flight]), owner));
        const keysFor = (kind: string) => days.filter((d) => d.entries.some((e) => e.kind === kind)).map((d) => d.key);
        expect(keysFor("flight")).toEqual([parts(start).date]);
        if (parts(start).date !== parts(end).date) expect(keysFor("arrival")).toEqual([parts(end).date]);
        expect(days.map((d) => d.key)).toEqual([...days.map((d) => d.key)].sort());
      }),
      fcParams(400),
    );
  });
});
