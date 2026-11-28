import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { fromLocal } from "../time/format";
import { DateTime } from "../time/luxon";
import type { ZonedTime } from "../types";
import { MIN_WINDOW_MS, sleepWindow, type SleepFlight } from "./sleep-window";

const NY = "America/New_York";
const HOUR = 3600_000;

function flight(depart: ZonedTime, hours: number, arriveZone: string, id = "f1"): SleepFlight {
  return { id, updatedAt: "2026-11-01T00:00:00.000Z", start: depart, end: { at: new Date(Date.parse(depart.at) + hours * HOUR).toISOString(), zone: arriveZone } };
}

const clockIn = (t: ZonedTime) => DateTime.fromISO(t.at, { zone: t.zone }).toFormat("ccc LLL d h:mma", { locale: "en-US" });

describe("the sleep window on a long eastbound flight (JFK to HND)", () => {
  const tokyo = sleepWindow(flight(fromLocal("2027-03-01T01:00", NY), 14, "Asia/Tokyo"), NY);

  it("starts at 8:00pm Tokyo time and ends 90 minutes before landing", () => {
    expect(tokyo).not.toBeNull();
    expect(tokyo?.from).toEqual({ at: fromLocal("2027-03-01T20:00", "Asia/Tokyo").at, zone: "Asia/Tokyo" });
    expect(tokyo?.until).toEqual({ at: fromLocal("2027-03-02T03:30", "Asia/Tokyo").at, zone: "Asia/Tokyo" });
    expect(tokyo?.minutes).toBe(450);
    expect(tokyo?.endsBeforeMeal).toBe(true);
  });

  it("reads the short line from the spec", () => {
    expect(tokyo?.line).toBe("Sleep tip: from 8:00pm Tokyo time (6:00am New York), about 7½ hours.");
  });

  it("explains the window, the meals, the landing and that it is not medical advice", () => {
    expect(tokyo?.why).toEqual([
      "To shift toward Tokyo time, stay awake until about 8:00pm Tokyo time (6:00am New York), then sleep until about 3:30am Tokyo time (1:30pm New York), before the meal served before landing.",
      "Meals are usually served about 1 to 2 hours after takeoff and about 1½ to 2 hours before landing.",
      "On landing at 5:00am, get daylight and stay up until about 9:00pm.",
      "General guidance, not medical advice.",
    ]);
  });
});

describe("the owner's JFK to HKG flight on Fri Jan 15 2027", () => {
  const hongKong = sleepWindow(flight(fromLocal("2027-01-15T09:00", NY), 16, "Asia/Hong_Kong"), NY);

  it("starts after the first meal, at midnight Hong Kong time, and ends at 6:00am", () => {
    expect(hongKong?.from).toEqual({ at: fromLocal("2027-01-16T00:00", "Asia/Hong_Kong").at, zone: "Asia/Hong_Kong" });
    expect(hongKong?.until).toEqual({ at: fromLocal("2027-01-16T06:00", "Asia/Hong_Kong").at, zone: "Asia/Hong_Kong" });
    expect(clockIn(hongKong?.from ?? fromLocal("2000-01-01T00:00", NY))).toBe("Sat Jan 16 12:00AM");
    expect(hongKong?.endsBeforeMeal).toBe(false);
  });

  it("reads the line and the landing hint from the spec", () => {
    expect(hongKong?.line).toBe("Sleep tip: from 12:00am Hong Kong time (11:00am New York), about 6 hours.");
    expect(hongKong?.landingHint).toBe("On landing at 2:00pm, stay up until about 9:00pm.");
    expect(hongKong?.why[0]).toBe("To shift toward Hong Kong time, stay awake until about 12:00am Hong Kong time (11:00am New York), then sleep until about 6:00am Hong Kong time (5:00pm New York).");
  });
});

describe("when there is no sleep tip", () => {
  it("is silent under 7 hours even across many zones", () => {
    expect(sleepWindow(flight(fromLocal("2027-03-01T10:00", "Europe/London"), 6.9, "Asia/Dubai"), NY)).toBeNull();
    expect(sleepWindow(flight(fromLocal("2027-03-01T10:00", NY), 6, "Europe/London"), NY)).toBeNull();
  });

  it("is silent when fewer than 5 zones are crossed, and speaks at exactly 5", () => {
    expect(sleepWindow(flight(fromLocal("2027-03-01T09:00", "Europe/London"), 12, "Asia/Dubai"), NY)).toBeNull();
    expect(sleepWindow(flight(fromLocal("2027-03-01T09:00", NY), 12, "America/Sao_Paulo"), NY)).toBeNull();
    expect(sleepWindow(flight(fromLocal("2027-03-01T09:00", NY), 12, "Europe/London"), NY)).not.toBeNull();
  });

  it("is silent when the window would be under 3 hours", () => {
    expect(sleepWindow(flight(fromLocal("2027-03-01T09:00", NY), 7, "Europe/London"), NY)).toBeNull();
  });

  it("is silent when the flight would have you sleeping in the middle of the destination's day", () => {
    expect(sleepWindow(flight(fromLocal("2027-03-01T02:00", NY), 12, "Europe/London"), NY)).toBeNull();
  });

  it("counts zones from the offsets on the day, so a spring change does not hide a real crossing", () => {
    expect(sleepWindow(flight(fromLocal("2027-03-13T22:00", NY), 14, "Asia/Tokyo"), NY)).not.toBeNull();
  });
});

describe("the landing hint", () => {
  it("both kinds of hint come out of real flights", () => {
    const hints = new Set<string>();
    for (let hour = 0; hour < 24; hour += 1) {
      for (const length of [10, 12, 14, 16]) {
        const found = sleepWindow(flight(fromLocal(`2027-03-01T${String(hour).padStart(2, "0")}:00`, NY), length, "Asia/Tokyo"), NY);
        if (found) hints.add(found.landingHint.replace(/\d{1,2}:\d{2}[ap]m/, "T"));
      }
    }
    expect([...hints].sort()).toEqual(["On landing at T, go to bed at local bedtime.", "On landing at T, stay up until about 9:00pm."]);
  });
});

describe("the window, whatever the flight", () => {
  const zones = ["Asia/Tokyo", "Asia/Hong_Kong", "Europe/London", "Australia/Sydney", "Asia/Dubai", "Pacific/Auckland", "America/Los_Angeles", "Europe/Paris"];
  const flights = fc.record({
    zoneFrom: fc.constantFrom(...zones),
    zoneTo: fc.constantFrom(...zones),
    startMs: fc.integer({ min: Date.parse("2026-01-01T00:00:00Z"), max: Date.parse("2028-12-31T00:00:00Z") }),
    hours: fc.integer({ min: 7, max: 20 }),
    quarter: fc.integer({ min: 0, max: 3 }),
  });

  function build(f: { zoneFrom: string; zoneTo: string; startMs: number; hours: number; quarter: number }): SleepFlight {
    const start = { at: new Date(f.startMs).toISOString(), zone: f.zoneFrom };
    return flight(start, f.hours + f.quarter / 4, f.zoneTo);
  }

  it("always sits inside the flight, after the first meal, before the landing meal, and lasts 3 hours or more", () => {
    fc.assert(
      fc.property(flights, (f) => {
        const input = build(f);
        const found = sleepWindow(input, NY);
        if (!found) return true;
        const from = Date.parse(found.from.at);
        const until = Date.parse(found.until.at);
        return from >= Date.parse(input.start.at) + 2 * HOUR && until <= Date.parse(input.end.at) - 1.5 * HOUR && until - from >= MIN_WINDOW_MS && found.minutes === Math.round((until - from) / 60000);
      }),
      { numRuns: 500 },
    );
  });

  it("never starts before 8:00pm destination time of the evening it belongs to, and never ends after the next 6:00am", () => {
    fc.assert(
      fc.property(flights, (f) => {
        const input = build(f);
        const found = sleepWindow(input, NY);
        if (!found) return true;
        const from = DateTime.fromISO(found.from.at, { zone: found.from.zone });
        const until = DateTime.fromISO(found.until.at, { zone: found.until.zone });
        const eveningOrLater = from.hour >= 20 || from.hour < 6;
        const morningOrEarlier = until.diff(from).as("hours") <= 10 && (until.hour < 6 || (until.hour === 6 && until.minute === 0) || Date.parse(found.until.at) === Date.parse(input.end.at) - 1.5 * HOUR);
        return eveningOrLater && morningOrEarlier;
      }),
      { numRuns: 500 },
    );
  });

  it("is silent whenever the flight is short or crosses few zones, and otherwise reads one short line", () => {
    fc.assert(
      fc.property(flights, (f) => {
        const input = build(f);
        const found = sleepWindow(input, NY);
        const offset = Math.abs(DateTime.fromISO(input.end.at, { zone: input.end.zone }).offset - DateTime.fromISO(input.start.at, { zone: input.start.zone }).offset) / 60;
        if (offset < 5) return found === null;
        return found === null || (/^Sleep tip: from \d{1,2}:\d{2}[ap]m .+ time( \(\d{1,2}:\d{2}[ap]m .+\))?, about \d+½? hours?\.$/.test(found.line) && found.why.length === 4);
      }),
      { numRuns: 500 },
    );
  });

  it("gives the same answer twice and a key that changes when the flight is edited", () => {
    fc.assert(
      fc.property(flights, (f) => {
        const input = build(f);
        const again = sleepWindow(input, NY);
        const edited = sleepWindow({ ...input, updatedAt: "2026-12-01T00:00:00.000Z" }, NY);
        return JSON.stringify(sleepWindow(input, NY)) === JSON.stringify(again) && (again === null || edited === null || again.key !== edited.key);
      }),
      { numRuns: 200 },
    );
  });
});
