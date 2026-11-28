import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { buildFixtureTrip, USERS } from "@/fixtures/december-trip";
import { buildDemoTrip, type DemoTripSpec } from "@/fixtures/demo-trips";
import { nightStatuses } from "../checks/checks";
import { DateTime } from "../time/luxon";
import { projectTrip, type TripView } from "../visibility/project";
import type { Requester, TripAggregate } from "../types";
import { sleepPlan, type SleepStretch } from "./sleep-plan";

const kenny: Requester = { kind: "member", userId: USERS.kenny.id, homeZone: "America/New_York" };

function viewOf(agg: TripAggregate, estimatedEnds = false): TripView {
  const view = projectTrip(agg, kenny);
  return estimatedEnds ? { ...view, items: view.items.map((i) => (i.type === "flight" ? { ...i, endIsEstimated: true } : i)) } : view;
}

function trip(items: DemoTripSpec["items"]): TripAggregate {
  return buildDemoTrip({ index: 9, name: "Hong Kong in January", travelers: ["Kenneth Yu"], members: [{ user: "kenny", role: "owner" }], items });
}

const outbound = (departLocal: string, arriveLocal: string) => ({
  input: { type: "flight" as const, flightNumber: "CX845", fromAirport: "JFK", toAirport: "HKG", departLocal, arriveLocal },
});
const inbound = { input: { type: "flight" as const, flightNumber: "CX846", fromAirport: "HKG", toAirport: "JFK", departLocal: "2026-01-27T16:00", arriveLocal: "2026-01-27T19:00" } };
const hongKongStay = { input: { type: "stay" as const, name: "Harbour Hotel", city: "Hong Kong", checkInDate: "2026-01-16", checkInTime: "15:00", checkOutDate: "2026-01-27", checkOutTime: "11:00" } };

const worked = () => trip([outbound("2026-01-15T09:00", "2026-01-16T14:00"), inbound]);

function onlyStretch(plan: ReturnType<typeof sleepPlan>): SleepStretch {
  expect(plan.stretches).toHaveLength(1);
  return plan.stretches[0];
}

describe("the owner's worked example: Jan 15 to 27 in Hong Kong", () => {
  const plan = sleepPlan(viewOf(worked(), true));
  const block = onlyStretch(plan);

  it("needs eleven beds in Hong Kong, check in Fri Jan 16, check out Tue Jan 27", () => {
    expect(block.city).toBe("Hong Kong");
    expect(block.nights).toHaveLength(11);
    expect(block.nights[0]).toBe("2026-01-16");
    expect(block.nights.at(-1)).toBe("2026-01-26");
    expect(block.checkIn).toBe("2026-01-16");
    expect(block.checkOut).toBe("2026-01-27");
    expect(block.title).toBe("Hong Kong, 11 nights");
    expect(block.datesLine).toBe("Check in Fri Jan 16, check out Tue Jan 27");
  });

  it("says when you land and when you fly out, in local time with home time in brackets", () => {
    expect(block.arrivalLine).toBe("You land Fri Jan 16, about 2:00pm Hong Kong time (1:00am New York).");
    expect(block.departureLine).toBe("You fly out Tue Jan 27, 4:00pm Hong Kong time (3:00am New York).");
  });

  it("warns only about the long gap before the flight, because ready at 3:30pm is after the 3:00pm check in", () => {
    expect(block.warnings).toEqual(["Check-out is usually 11:00am and you leave for the airport around 1:00pm. Ask for a late check-out, or plan 2 hours with your bags."]);
  });

  it("puts the night of Thu Jan 15 on the plane, with no bed", () => {
    expect(plan.planeNights).toEqual([{ night: "2026-01-15", line: "Thu Jan 15: on the plane. No bed needed." }]);
  });

  it("lists the plane night before the stretch, in date order", () => {
    expect(plan.entries.map((e) => e.kind)).toEqual(["plane", "stretch"]);
  });

  it("drops the word about when the arrival time is not an estimate", () => {
    const exact = onlyStretch(sleepPlan(viewOf(worked())));
    expect(exact.arrivalLine).toBe("You land Fri Jan 16, 2:00pm Hong Kong time (1:00am New York).");
  });
});

describe("arrival that crosses midnight", () => {
  const late = trip([outbound("2026-01-15T22:00", "2026-01-17T03:00"), inbound]);
  const plan = sleepPlan(viewOf(late));
  const block = onlyStretch(plan);

  it("moves the check in to the night before, so the room is ready when you arrive", () => {
    expect(block.warnings[0]).toBe("You get there around 4:30am on Sat Jan 17. Book from the night of Fri Jan 16, so the room is yours when you arrive.");
    expect(block.checkIn).toBe("2026-01-16");
    expect(block.nights[0]).toBe("2026-01-16");
    expect(block.nights).toHaveLength(11);
  });

  it("no longer counts that night as on the plane", () => {
    expect(plan.planeNights.map((p) => p.night)).toEqual(["2026-01-15"]);
  });

  it("keeps at most two warnings, arrival first", () => {
    expect(block.warnings).toHaveLength(2);
    expect(block.warnings[1]).toContain("late check-out");
  });
});

describe("arriving early in the morning", () => {
  it("suggests an early check in, naming the usual 3:00pm", () => {
    const early = trip([outbound("2026-01-15T09:00", "2026-01-16T07:00"), inbound]);
    expect(onlyStretch(sleepPlan(viewOf(early))).warnings[0]).toBe(
      "You get there around 8:30am, well before the usual 3:00pm check-in. Ask for an early check-in, or book the night before so the room is ready.",
    );
  });
});

describe("leaving very early", () => {
  it("warns when you leave for the airport before 5:00am", () => {
    const earlyFlight = trip([outbound("2026-01-15T09:00", "2026-01-16T14:00"), { input: { ...inbound.input, departLocal: "2026-01-27T07:00", arriveLocal: "2026-01-27T09:00" } }]);
    const block = onlyStretch(sleepPlan(viewOf(earlyFlight)));
    expect(block.warnings.at(-1)).toBe("You leave for the airport around 4:00am. Stay near the airport the last night, or check the hotel's front desk hours.");
  });
});

describe("a stay that covers the nights", () => {
  it("leaves no stretch and no section", () => {
    const covered = trip([outbound("2026-01-15T09:00", "2026-01-16T14:00"), hongKongStay, inbound]);
    const plan = sleepPlan(viewOf(covered));
    expect(plan.stretches).toEqual([]);
    expect(plan.planeNights.map((p) => p.night)).toEqual(["2026-01-15"]);
  });

  it("shows only the nights the stay leaves open", () => {
    const shortStay = { input: { ...hongKongStay.input, checkOutDate: "2026-01-20" } };
    const plan = sleepPlan(viewOf(trip([outbound("2026-01-15T09:00", "2026-01-16T14:00"), shortStay, inbound])));
    const block = onlyStretch(plan);
    expect(block.checkIn).toBe("2026-01-20");
    expect(block.nights).toHaveLength(7);
  });
});

describe("a trip with no flights", () => {
  it("has nothing to plan", () => {
    expect(sleepPlan(viewOf(trip([hongKongStay])))).toEqual({ stretches: [], planeNights: [], entries: [] });
  });
});

describe("the December fixture, all booked", () => {
  it("lists only the nights its own check already calls open", () => {
    const view = projectTrip(buildFixtureTrip(), kenny);
    const open = nightStatuses(view).filter((n) => n.state === "open" && n.city !== null);
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
        const statuses = nightStatuses(view);
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
