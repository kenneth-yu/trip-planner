import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { present } from "@/testing/present";
import { buildFixtureTrip, USERS } from "@/fixtures/december-trip";
import { buildDemoTrip, type DemoTripSpec } from "@/fixtures/demo-trips";
import { nightStatuses } from "../checks/checks";
import { instantMs, localDateKey } from "../time/format";
import { DateTime } from "../time/luxon";
import { projectTrip, type TripView } from "../visibility/project";
import type { Requester, TripAggregate } from "../types";
import { sleepPlan, type SleepPlan, type SleepStretch } from "./sleep-plan";

const kenny: Requester = { kind: "member", userId: USERS.kenny.id, homeZone: "America/New_York" };

function viewOf(agg: TripAggregate, estimatedEnds = false): TripView {
  const view = projectTrip(agg, kenny);
  return estimatedEnds ? { ...view, items: view.items.map((i) => (i.type === "flight" ? { ...i, endIsEstimated: true } : i)) } : view;
}

function trip(items: DemoTripSpec["items"]): TripAggregate {
  return buildDemoTrip({ index: 9, name: "Hong Kong in January", travelers: ["Kenneth Yu"], members: [{ user: "kenny", role: "owner" }], items });
}

const flight = (fromAirport: string, toAirport: string, departLocal: string, arriveLocal: string, flightNumber = "CX845") => ({
  input: { type: "flight" as const, flightNumber, fromAirport, toAirport, departLocal, arriveLocal },
});
const outbound = (departLocal: string, arriveLocal: string) => flight("JFK", "HKG", departLocal, arriveLocal);
const inbound = flight("HKG", "JFK", "2027-01-27T16:00", "2027-01-27T18:30", "CX846");
const hongKongStay = { input: { type: "stay" as const, name: "Harbour Hotel", city: "Hong Kong", checkInDate: "2027-01-16", checkInTime: "15:00", checkOutDate: "2027-01-27", checkOutTime: "11:00" } };

const worked = () => trip([outbound("2027-01-15T09:00", "2027-01-16T14:00"), inbound]);

function onlyStretch(plan: SleepPlan): SleepStretch {
  expect(plan.stretches).toHaveLength(1);
  return plan.stretches[0];
}

function everyText(plan: SleepPlan): string[] {
  return [
    ...plan.stretches.flatMap((s) => [s.title, s.datesLine, s.arrivalLine ?? "", s.departureLine ?? "", ...s.warnings]),
    ...plan.planeNights.flatMap((p) => [p.line, p.explanation]),
    ...(plan.summary ? [plan.summary.heading, ...plan.summary.stretchLines.map((l) => l.line), ...plan.summary.skippedLines] : []),
  ];
}

describe("the owner's worked example: Jan 15 to 27, 2027, in Hong Kong", () => {
  const plan = sleepPlan(viewOf(worked(), true));
  const block = onlyStretch(plan);

  it("needs eleven beds in Hong Kong, check in Sat Jan 16, check out Wed Jan 27", () => {
    expect(block.city).toBe("Hong Kong");
    expect(block.nights).toHaveLength(11);
    expect(block.nights[0]).toBe("2027-01-16");
    expect(block.nights.at(-1)).toBe("2027-01-26");
    expect(block.checkIn).toBe("2027-01-16");
    expect(block.checkOut).toBe("2027-01-27");
    expect(block.title).toBe("Hong Kong, 11 nights");
    expect(block.datesLine).toBe("Check in Sat Jan 16, check out Wed Jan 27");
  });

  it("gives the headline: the count, the dates, and the nights you can skip", () => {
    expect(plan.summary).toEqual({
      nights: 11,
      checkIn: "2027-01-16",
      checkOut: "2027-01-27",
      cities: ["Hong Kong"],
      heading: "You need a place to stay: 11 nights",
      stretchLines: [{ city: "Hong Kong", checkIn: "2027-01-16", checkOut: "2027-01-27", line: "Hong Kong: check in Sat Jan 16, check out Wed Jan 27" }],
      skippedLines: [
        "No bed needed on Fri Jan 15: you're on the plane overnight and land Sat Jan 16 at about 2:00pm Hong Kong time.",
        "Coming home, you land in New York on Wed Jan 27 at about 6:30pm, the same day you leave Hong Kong. No night on the plane.",
      ],
    });
  });

  it("says when you land and when you fly out, in local time with home time in brackets", () => {
    expect(block.arrivalLine).toBe("You land Sat Jan 16, about 2:00pm Hong Kong time (1:00am New York).");
    expect(block.departureLine).toBe("You fly out Wed Jan 27, 4:00pm Hong Kong time (3:00am New York).");
  });

  it("warns only about the long gap before the flight, because ready at 3:30pm is after the 3:00pm check in", () => {
    expect(block.warnings).toEqual(["Check-out is usually 11:00am and you leave for the airport around 1:00pm. Ask for a late check-out, or plan 2 hours with your bags."]);
  });

  it("keeps the skipped night as data: an overnight flight landing about 2:00pm Hong Kong time", () => {
    expect(plan.planeNights).toHaveLength(1);
    expect(plan.planeNights[0]).toMatchObject({
      night: "2027-01-15",
      reason: "overnight_flight",
      landsIsEstimated: true,
      landsCity: "Hong Kong",
      line: "Fri Jan 15: on the plane. No bed needed.",
      explanation: "You are on the plane overnight and land Sat Jan 16, about 2:00pm Hong Kong time (1:00am New York).",
    });
    expect(plan.planeNights[0].lands).toMatchObject({ zone: "Asia/Hong_Kong" });
  });

  it("lists the plane night before the stretch, in date order", () => {
    expect(plan.entries.map((e) => e.kind)).toEqual(["plane", "stretch"]);
  });

  it("drops the word about when the arrival time is not an estimate", () => {
    const exact = sleepPlan(viewOf(worked()));
    expect(onlyStretch(exact).arrivalLine).toBe("You land Sat Jan 16, 2:00pm Hong Kong time (1:00am New York).");
    expect(exact.summary?.skippedLines[0]).toBe("No bed needed on Fri Jan 15: you're on the plane overnight and land Sat Jan 16 at 2:00pm Hong Kong time.");
  });

  it("names every weekday against the January 2027 calendar", () => {
    const calendar: Record<string, string> = { "15": "Fri", "16": "Sat", "17": "Sun", "21": "Thu", "26": "Tue", "27": "Wed" };
    const texts = [
      ...everyText(plan),
      ...everyText(sleepPlan(viewOf(trip([outbound("2027-01-15T22:00", "2027-01-17T03:00"), inbound])))),
    ];
    const seen = texts.flatMap((t) => Array.from(t.matchAll(/\b(Mon|Tue|Wed|Thu|Fri|Sat|Sun) Jan (\d+)\b/g)));
    expect(seen.length).toBeGreaterThan(8);
    for (const m of seen) expect(calendar[m[2]], `${m[0]} in 2027`).toBe(m[1]);
  });
});

describe("shrinking when a stay covers some nights", () => {
  it("counts only what is left: six nights from Thu Jan 21", () => {
    const part = { input: { ...hongKongStay.input, checkOutDate: "2027-01-21" } };
    const plan = sleepPlan(viewOf(trip([outbound("2027-01-15T09:00", "2027-01-16T14:00"), part, inbound]), true));
    expect(plan.summary?.heading).toBe("You need a place to stay: 6 nights");
    expect(plan.summary?.stretchLines[0].line).toBe("Hong Kong: check in Thu Jan 21, check out Wed Jan 27");
  });

  it("disappears when every night is covered, leaving no summary and no stretch", () => {
    const plan = sleepPlan(viewOf(trip([outbound("2027-01-15T09:00", "2027-01-16T14:00"), hongKongStay, inbound])));
    expect(plan.stretches).toEqual([]);
    expect(plan.summary).toBeNull();
    expect(plan.planeNights.map((p) => p.night)).toEqual(["2027-01-15"]);
  });
});

describe("arrival that crosses midnight", () => {
  const late = trip([outbound("2027-01-15T22:00", "2027-01-17T03:00"), inbound]);
  const plan = sleepPlan(viewOf(late));
  const block = onlyStretch(plan);

  it("moves the check in to the night before, so the room is ready when you arrive", () => {
    expect(block.warnings[0]).toBe("You get there around 4:30am on Sun Jan 17. Book from the night of Sat Jan 16, so the room is yours when you arrive.");
    expect(block.checkIn).toBe("2027-01-16");
    expect(block.nights[0]).toBe("2027-01-16");
    expect(block.nights).toHaveLength(11);
  });

  it("no longer counts that night as on the plane", () => {
    expect(plan.planeNights.map((p) => p.night)).toEqual(["2027-01-15"]);
    expect(plan.summary?.skippedLines[0]).toContain("No bed needed on Fri Jan 15:");
  });

  it("keeps at most two warnings, arrival first", () => {
    expect(block.warnings).toHaveLength(2);
    expect(block.warnings[1]).toContain("late check-out");
  });
});

describe("arriving early in the morning", () => {
  it("suggests an early check in, naming the usual 3:00pm", () => {
    const early = trip([outbound("2027-01-15T09:00", "2027-01-16T07:00"), inbound]);
    expect(onlyStretch(sleepPlan(viewOf(early))).warnings[0]).toBe(
      "You get there around 8:30am, well before the usual 3:00pm check-in. Ask for an early check-in, or book the night before so the room is ready.",
    );
  });
});

describe("leaving very early", () => {
  it("warns when you leave for the airport before 5:00am", () => {
    const earlyFlight = trip([outbound("2027-01-15T09:00", "2027-01-16T14:00"), flight("HKG", "JFK", "2027-01-27T07:00", "2027-01-27T09:00", "CX846")]);
    const block = onlyStretch(sleepPlan(viewOf(earlyFlight)));
    expect(block.warnings.at(-1)).toBe("You leave for the airport around 4:00am. Stay near the airport the last night, or check the hotel's front desk hours.");
  });
});

describe("crossing the date line", () => {
  it("westward over two calendar dates, names both lost nights in one line", () => {
    const plan = sleepPlan(viewOf(trip([flight("LAX", "SYD", "2027-01-15T22:00", "2027-01-17T08:30"), flight("SYD", "LAX", "2027-01-25T10:00", "2027-01-25T06:00", "QF12")]), true));
    expect(plan.summary?.skippedLines[0]).toBe("No bed needed on Fri Jan 15 or Sat Jan 16: you cross the date line and land Sun Jan 17 at about 8:30am Sydney time.");
  });

  it("a day gained on the way home says there is no night on the plane", () => {
    const plan = sleepPlan(viewOf(trip([flight("LAX", "SYD", "2027-01-15T22:00", "2027-01-17T08:30"), flight("SYD", "LAX", "2027-01-25T10:00", "2027-01-25T06:00", "QF12")]), true));
    expect(plan.summary?.skippedLines.at(-1)).toBe("Coming home, you land in Los Angeles on Mon Jan 25 at about 6:00am, the same day you leave Sydney. No night on the plane.");
  });

  it("a day gained away from home counts that night and names the city", () => {
    const plan = sleepPlan(viewOf(trip([flight("NRT", "HNL", "2027-01-15T20:00", "2027-01-15T09:00", "JL72"), flight("HNL", "NRT", "2027-01-20T12:00", "2027-01-21T16:00", "JL71")]), true));
    expect(plan.summary?.skippedLines[0]).toBe("You land in Honolulu on Fri Jan 15 at about 9:00am, the same day you leave Tokyo, so you need a bed in Honolulu that night.");
  });

  it("landing on the calendar day before you left says so", () => {
    const plan = sleepPlan(viewOf(trip([flight("NRT", "HNL", "2027-01-15T08:00", "2027-01-14T21:00", "JL72"), flight("HNL", "NRT", "2027-01-20T12:00", "2027-01-21T16:00", "JL71")]), true));
    expect(plan.summary?.skippedLines[0]).toBe("You land in Honolulu on Thu Jan 14, the day before you left Tokyo by the calendar, so you need a bed there from the night of Thu Jan 14.");
  });

  it("a short flight inside one date says nothing", () => {
    const plan = sleepPlan(viewOf(trip([flight("JFK", "LHR", "2027-01-15T22:00", "2027-01-16T10:00", "BA112"), flight("LHR", "JFK", "2027-01-20T10:00", "2027-01-20T10:30", "BA117")])));
    expect(plan.summary?.skippedLines.some((l) => l.includes("Coming home"))).toBe(false);
  });
});

describe("a trip with no flights", () => {
  it("has nothing to plan", () => {
    expect(sleepPlan(viewOf(trip([hongKongStay])))).toEqual({ stretches: [], planeNights: [], entries: [], summary: null });
  });
});

describe("the December fixture, all booked", () => {
  it("lists only the nights its own check already calls open", () => {
    const view = projectTrip(buildFixtureTrip(), kenny);
    const landing = localDateKey(present(view.items.filter((i) => i.type === "flight").sort((a, b) => instantMs(a.start) - instantMs(b.start))[0]).end);
    const open = nightStatuses(view).filter((n) => n.state === "open" && n.city !== null && n.night >= landing);
    const plan = sleepPlan(view);
    expect(plan.stretches.flatMap((s) => s.nights).sort()).toEqual(open.map((n) => n.night).sort());
  });
});

describe("every night is covered, on the plane, or in exactly one stretch", () => {
  const cities = [
    { code: "JFK", city: "New York" },
    { code: "HKG", city: "Hong Kong" },
    { code: "HND", city: "Tokyo" },
    { code: "LHR", city: "London" },
    { code: "SYD", city: "Sydney" },
    { code: "AKL", city: "Auckland" },
  ] as const;

  const hop = fc.record({
    to: fc.integer({ min: 0, max: cities.length - 1 }),
    wait: fc.integer({ min: 1, max: 5 }),
    hour: fc.integer({ min: 0, max: 23 }),
    hours: fc.integer({ min: 2, max: 20 }),
  });
  const stay = fc.option(fc.record({ from: fc.integer({ min: 0, max: 6 }), length: fc.integer({ min: 1, max: 5 }) }), { nil: null });

  it("holds for random flight sequences with and without stays", () => {
    fc.assert(
      fc.property(fc.array(hop, { minLength: 1, maxLength: 3 }), fc.array(stay, { maxLength: 3 }), (hops, stays) => {
        let here = 0;
        let departAt = DateTime.fromISO("2026-03-02T00:00", { zone: "utc" });
        const items: DemoTripSpec["items"] = [];
        const zones = { JFK: "America/New_York", HKG: "Asia/Hong_Kong", HND: "Asia/Tokyo", LHR: "Europe/London", SYD: "Australia/Sydney", AKL: "Pacific/Auckland" };
        hops.forEach((h, i) => {
          const to = h.to === here ? (h.to + 1) % cities.length : h.to;
          const from = cities[here];
          const dest = cities[to];
          const depart = departAt.plus({ days: h.wait }).set({ hour: h.hour, minute: 0 });
          const localDepart = DateTime.fromMillis(depart.toMillis(), { zone: zones[from.code] });
          const arrive = depart.plus({ hours: h.hours });
          const localArrive = DateTime.fromMillis(arrive.toMillis(), { zone: zones[dest.code] });
          items.push({
            input: {
              type: "flight",
              flightNumber: `XX${100 + i}`,
              fromAirport: from.code,
              toAirport: dest.code,
              departLocal: localDepart.toFormat("yyyy-MM-dd'T'HH:mm"),
              arriveLocal: localArrive.toFormat("yyyy-MM-dd'T'HH:mm"),
            },
          });
          here = to;
          departAt = arrive;
        });
        const firstArrival = items[0].input;
        if (firstArrival.type === "flight") {
          const base = DateTime.fromISO(firstArrival.arriveLocal.slice(0, 10));
          const destination = cities.find((c) => c.code === firstArrival.toAirport);
          for (const s of stays) {
            if (!s || !destination) continue;
            const checkIn = base.plus({ days: s.from });
            items.push({ input: { type: "stay", name: "Stay", city: destination.city, checkInDate: checkIn.toISODate(), checkOutDate: checkIn.plus({ days: s.length }).toISODate() } });
          }
        }
        let view: TripView;
        try {
          view = viewOf(trip(items));
        } catch {
          return;
        }
        const landing = localDateKey(present(view.items.filter((i) => i.type === "flight").sort((a, b) => instantMs(a.start) - instantMs(b.start))[0]).end);
        const statuses = nightStatuses(view).filter((n) => n.night >= landing);
        const plan = sleepPlan(view);
        const inStretches = plan.stretches.flatMap((s) => s.nights);
        expect(new Set(inStretches).size, "no night is in two stretches").toBe(inStretches.length);
        const plane = new Set(plan.planeNights.map((p) => p.night));
        for (const n of plan.planeNights) expect(inStretches).not.toContain(n.night);
        for (const s of statuses) {
          const placed = inStretches.filter((x) => x === s.night).length + (plane.has(s.night) ? 1 : 0);
          if (s.state === "covered") expect(placed, `${s.night} has a stay`).toBe(0);
          if (s.state === "air") expect(placed, `${s.night} is in the air`).toBeLessThanOrEqual(1);
          if (s.state === "open" && s.city !== null) expect(placed, `${s.night} needs a bed`).toBe(1);
        }
      }),
      { numRuns: 80 },
    );
  });
});
