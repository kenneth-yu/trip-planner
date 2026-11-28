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
    ...(plan.summary ? [plan.summary.heading, ...plan.summary.stretchLines.map((l) => l.line), ...plan.summary.hints.flatMap((h) => [h.text, h.why]), ...plan.summary.nightNotes] : []),
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
      stretchLines: [{ city: "Hong Kong", checkIn: "2027-01-16", checkOut: "2027-01-27", line: "Check in Sat Jan 16 · Check out Wed Jan 27" }],
      hints: [
        {
          text: "Not Fri Jan 15: you're on the plane.",
          why: "You leave New York Fri Jan 15 at 9:00am and land in Hong Kong Sat Jan 16 at about 2:00pm Hong Kong time (1:00am New York). The night of Fri Jan 15 is spent on the plane.",
        },
      ],
      moreHints: 0,
      nightNotes: [
        "You leave New York Fri Jan 15 at 9:00am and land in Hong Kong Sat Jan 16 at about 2:00pm Hong Kong time (1:00am New York). The night of Fri Jan 15 is spent on the plane.",
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
    expect(exact.summary?.hints[0].why).toContain("land in Hong Kong Sat Jan 16 at 2:00pm Hong Kong time");
    expect(exact.summary?.hints[0].why).not.toContain("about");
  });

  it("names every weekday against the January 2027 calendar, checked with Luxon", () => {
    const texts = [
      ...everyText(plan),
      ...everyText(sleepPlan(viewOf(trip([outbound("2027-01-15T22:00", "2027-01-17T03:00"), inbound])))),
      ...everyText(sleepPlan(viewOf(trip([flight("NRT", "HNL", "2027-01-15T01:00", "2027-01-14T13:00", "JL72"), flight("HNL", "NRT", "2027-01-20T12:00", "2027-01-21T16:00", "JL71")]), true))),
    ];
    const seen = texts.flatMap((t) => Array.from(t.matchAll(/\b(Mon|Tue|Wed|Thu|Fri|Sat|Sun) (Jan|Feb) (\d+)\b/g)));
    expect(seen.length).toBeGreaterThan(12);
    for (const m of seen) {
      const real = DateTime.fromObject({ year: 2027, month: m[2] === "Jan" ? 1 : 2, day: Number(m[3]) }).toFormat("ccc", { locale: "en-US" });
      expect(m[1], `${m[0]} in 2027`).toBe(real);
    }
  });
});

describe("shrinking when a stay covers some nights", () => {
  it("counts only what is left: six nights from Thu Jan 21", () => {
    const part = { input: { ...hongKongStay.input, checkOutDate: "2027-01-21" } };
    const plan = sleepPlan(viewOf(trip([outbound("2027-01-15T09:00", "2027-01-16T14:00"), part, inbound]), true));
    expect(plan.summary?.heading).toBe("You need a place to stay: 6 nights");
    expect(plan.summary?.stretchLines[0].line).toBe("Check in Thu Jan 21 · Check out Wed Jan 27");
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
    expect(plan.summary?.hints[0].text).toBe("Not Fri Jan 15: you're on the plane.");
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

describe("two calendar dates that are not a date line", () => {
  it("New York to Hong Kong landing 3:00am two dates later does not claim a date line", () => {
    const plan = sleepPlan(viewOf(trip([outbound("2027-01-15T22:00", "2027-01-17T03:00"), inbound]), true));
    const hint = plan.summary?.hints[0];
    expect(hint?.text).toBe("Not Fri Jan 15: you're on the plane.");
    expect(hint?.why).toBe("You leave New York Fri Jan 15 at 10:00pm and land in Hong Kong Sun Jan 17 at about 3:00am Hong Kong time (2:00pm Sat New York). The night of Fri Jan 15 is spent on the plane.");
    expect(hint?.why).not.toContain("date line");
    expect(plan.planeNights[0].reason).toBe("overnight_flight");
  });

  it("names both lost nights, still without a date line, when nothing moves into a stay", () => {
    const plan = sleepPlan(viewOf(trip([outbound("2027-01-15T22:00", "2027-01-17T15:00"), inbound]), true));
    const hint = plan.summary?.hints[0];
    expect(hint?.text).toBe("Not Fri Jan 15 or Sat Jan 16: you're on the plane.");
    expect(hint?.why).toContain("The clocks jump ahead, so the nights of Fri Jan 15 and Sat Jan 16 are spent on the plane.");
    expect(hint?.why).not.toContain("date line");
  });
});

describe("crossing the date line, with the spec's own flights", () => {
  it("Los Angeles to Sydney, Fri Jan 15 10:30pm, 15 hours, skips Sat Jan 16", () => {
    const plan = sleepPlan(viewOf(trip([flight("LAX", "SYD", "2027-01-15T22:30", "2027-01-17T08:30"), flight("SYD", "LAX", "2027-01-25T10:00", "2027-01-25T06:00", "QF12")]), true));
    expect(plan.summary?.hints[0]).toEqual({
      text: "Not Fri Jan 15 or Sat Jan 16: you're on the plane.",
      why: "You leave Los Angeles Fri Jan 15 at 10:30pm and land in Sydney Sun Jan 17 at about 8:30am Sydney time. Crossing the date line skips Sat Jan 16, so you spend the nights of Fri Jan 15 and Sat Jan 16 on the plane.",
    });
    expect(plan.planeNights.map((p) => p.reason)).toEqual(["date_line", "date_line"]);
  });

  it("Sydney to Los Angeles, Fri Jan 15 9:00pm, 13h 30m, lands the same day and needs a bed", () => {
    const plan = sleepPlan(viewOf(trip([flight("SYD", "LAX", "2027-01-15T21:00", "2027-01-15T15:30", "QF11"), flight("LAX", "SYD", "2027-01-25T22:00", "2027-01-27T07:00", "QF12")]), true));
    expect(plan.summary?.hints[0]).toEqual({
      text: "Includes Fri Jan 15: you land the same day you leave.",
      why: "You leave Sydney Fri Jan 15 at 9:00pm and land in Los Angeles Fri Jan 15 at about 3:30pm. You cross the date line, so you need a bed in Los Angeles that night.",
    });
  });

  it("Tokyo to Honolulu, Fri Jan 15 1:00am, lands Thu Jan 14 at 1:00pm", () => {
    const plan = sleepPlan(viewOf(trip([flight("NRT", "HNL", "2027-01-15T01:00", "2027-01-14T13:00", "JL72"), flight("HNL", "NRT", "2027-01-20T12:00", "2027-01-21T16:00", "JL71")]), true));
    expect(plan.summary?.hints[0]).toEqual({
      text: "Includes Thu Jan 14: you land the day before you left.",
      why: "You leave Tokyo Fri Jan 15 at 1:00am and land in Honolulu Thu Jan 14 at about 1:00pm Honolulu time. Crossing the date line puts you a day back, so you need a bed there from the night of Thu Jan 14.",
    });
  });

  it("a day gained on the way home has no hint, only the Night by night line", () => {
    const summary = sleepPlan(viewOf(trip([flight("LAX", "SYD", "2027-01-15T22:30", "2027-01-17T08:30"), flight("SYD", "LAX", "2027-01-25T10:00", "2027-01-25T06:00", "QF12")]), true)).summary;
    expect(summary?.hints).toHaveLength(1);
    expect(summary?.nightNotes.at(-1)).toBe("Coming home, you land in Los Angeles on Mon Jan 25 at about 6:00am, the same day you leave Sydney. No night on the plane.");
  });

  it("an ordinary long flight within one date says the clocks go back, not the date line", () => {
    const plan = sleepPlan(viewOf(trip([flight("HKG", "LHR", "2027-01-15T10:00", "2027-01-15T14:00", "CX252"), flight("LHR", "HKG", "2027-01-25T22:00", "2027-01-26T16:00", "CX251")]), true));
    const hint = plan.summary?.hints[0];
    expect(hint?.why).toContain("The clocks go back, so you need a bed in London that night.");
    expect(hint?.why).not.toContain("date line");
  });

  it("a short flight inside one date says nothing", () => {
    const plan = sleepPlan(viewOf(trip([flight("JFK", "LHR", "2027-01-15T22:00", "2027-01-16T10:00", "BA112"), flight("LHR", "JFK", "2027-01-20T10:00", "2027-01-20T10:30", "BA117")])));
    expect(plan.summary?.nightNotes.some((l) => l.includes("Coming home"))).toBe(false);
  });

  it("shows at most two hints and counts the rest", () => {
    const flights = [
      flight("LAX", "SYD", "2027-01-15T22:00", "2027-01-17T08:30", "QF11"),
      flight("SYD", "AKL", "2027-01-20T09:00", "2027-01-21T12:00", "NZ100"),
      flight("AKL", "HNL", "2027-01-23T08:00", "2027-01-22T21:00", "NZ101"),
    ];
    const plan = sleepPlan(viewOf(trip(flights), true));
    expect((plan.summary?.hints.length ?? 0) + (plan.summary?.moreHints ?? 0)).toBeGreaterThan(2);
    expect(plan.summary?.hints.length).toBeLessThanOrEqual(2);
  });
});

describe("once the trip has started", () => {
  const started = sleepPlan(viewOf(trip([outbound("2027-01-15T09:00", "2027-01-16T14:00"), inbound]), true), { from: "2027-01-20" });

  it("counts only the nights from today on", () => {
    expect(started.summary?.heading).toBe("You need a place to stay: 7 nights");
    expect(started.summary?.stretchLines[0].line).toBe("Check in Wed Jan 20 · Check out Wed Jan 27");
  });

  it("names no night that is already over, in the hints or the notes", () => {
    expect(started.summary?.hints).toEqual([]);
    expect(started.summary?.moreHints).toBe(0);
    const text = [...(started.summary?.hints.flatMap((h) => [h.text, h.why]) ?? []), ...(started.summary?.nightNotes ?? []), started.summary?.heading ?? ""].join(" ");
    expect(text).not.toContain("Fri Jan 15");
    expect(text).not.toContain("Sat Jan 16");
    expect(started.planeNights).toEqual([]);
  });

  it("keeps a later flight's hint, which no longer shares a slot with the one already flown", () => {
    const flights = [
      flight("JFK", "HKG", "2027-01-15T09:00", "2027-01-16T14:00", "CX845"),
      flight("HKG", "LAX", "2027-01-27T22:30", "2027-01-27T20:00", "CX880"),
      flight("LAX", "SYD", "2027-01-29T22:30", "2027-01-31T08:30", "QF11"),
    ];
    const plan = sleepPlan(viewOf(trip(flights), true), { from: "2027-01-20" });
    expect(plan.summary?.hints.map((h) => h.text)).toEqual(expect.arrayContaining(["Not Fri Jan 29 or Sat Jan 30: you're on the plane."]));
    for (const h of plan.summary?.hints ?? []) expect(h.text).not.toContain("Jan 15");
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
    { code: "JFK", city: "New York", zone: "America/New_York" },
    { code: "HKG", city: "Hong Kong", zone: "Asia/Hong_Kong" },
    { code: "HND", city: "Tokyo", zone: "Asia/Tokyo" },
    { code: "LHR", city: "London", zone: "Europe/London" },
    { code: "SYD", city: "Sydney", zone: "Australia/Sydney" },
    { code: "AKL", city: "Auckland", zone: "Pacific/Auckland" },
  ] as const;

  const hop = fc.record({
    to: fc.integer({ min: 0, max: cities.length - 1 }),
    wait: fc.integer({ min: 1, max: 5 }),
    hour: fc.integer({ min: 0, max: 23 }),
    hours: fc.integer({ min: 2, max: 20 }),
  });
  const stay = fc.option(fc.record({ from: fc.integer({ min: 0, max: 6 }), length: fc.integer({ min: 1, max: 5 }) }), { nil: null });

  interface Leg {
    from: (typeof cities)[number];
    to: (typeof cities)[number];
    start: DateTime;
    end: DateTime;
  }

  function build(hops: { to: number; wait: number; hour: number; hours: number }[], stays: ({ from: number; length: number } | null)[]) {
    let here = 0;
    let departAt = DateTime.fromISO("2026-03-02T00:00", { zone: "utc" });
    const legs: Leg[] = [];
    const items: DemoTripSpec["items"] = [];
    hops.forEach((h, i) => {
      const to = h.to === here ? (h.to + 1) % cities.length : h.to;
      const from = cities[here];
      const dest = cities[to];
      const start = departAt.plus({ days: h.wait }).set({ hour: h.hour, minute: 0 });
      const end = start.plus({ hours: h.hours });
      legs.push({ from, to: dest, start, end });
      items.push({
        input: {
          type: "flight",
          flightNumber: `XX${100 + i}`,
          fromAirport: from.code,
          toAirport: dest.code,
          departLocal: start.setZone(from.zone).toFormat("yyyy-MM-dd'T'HH:mm"),
          arriveLocal: end.setZone(dest.zone).toFormat("yyyy-MM-dd'T'HH:mm"),
        },
      });
      here = to;
      departAt = end;
    });
    const covered = new Set<string>();
    const arrival = legs[0].end.setZone(legs[0].to.zone);
    for (const s of stays) {
      if (!s) continue;
      const checkIn = arrival.startOf("day").plus({ days: s.from });
      const checkOut = checkIn.plus({ days: s.length });
      items.push({ input: { type: "stay", name: "Stay", city: legs[0].to.city, checkInDate: checkIn.toISODate(), checkOutDate: checkOut.toISODate() } });
      for (let d = checkIn; d < checkOut; d = d.plus({ days: 1 })) covered.add(d.toISODate());
    }
    return { legs, items, covered };
  }

  function oracle(legs: Leg[], covered: Set<string>): { night: string; state: "covered" | "air" | "open" }[] {
    const first = legs[0].end.setZone(legs[0].to.zone).toISODate();
    const stop = legs[legs.length - 1].start.setZone(legs[legs.length - 1].from.zone).toISODate();
    const out: { night: string; state: "covered" | "air" | "open" }[] = [];
    for (let d = DateTime.fromISO(first); d.toISODate() < stop; d = d.plus({ days: 1 })) {
      const night = d.toISODate();
      const landed = legs.filter((l) => l.end.setZone(l.to.zone).toISODate() <= night).at(-1);
      const zone = landed ? landed.to.zone : legs[0].to.zone;
      const bed = DateTime.fromISO(`${night}T23:30`, { zone }).toMillis();
      const airborne = legs.some((l) => l.start.toMillis() <= bed && bed < l.end.toMillis());
      out.push({ night, state: covered.has(night) ? "covered" : airborne ? "air" : "open" });
    }
    return out;
  }

  it("holds for random flight sequences with and without stays, against an independent count of nights", () => {
    let checked = 0;
    fc.assert(
      fc.property(fc.array(hop, { minLength: 1, maxLength: 3 }), fc.array(stay, { maxLength: 3 }), (hops, stays) => {
        const { legs, items, covered } = build(hops, stays);
        const plan = sleepPlan(viewOf(trip(items)));
        checked += 1;
        const inStretches = plan.stretches.flatMap((s) => s.nights);
        const plane = plan.planeNights.map((p) => p.night);
        const count = (night: string) => inStretches.filter((x) => x === night).length + plane.filter((x) => x === night).length;
        expect(new Set(inStretches).size, "no night is in two stretches").toBe(inStretches.length);
        for (const n of plane) expect(inStretches, `${n} is both on the plane and in a stretch`).not.toContain(n);
        for (const stretch of plan.stretches) {
          stretch.nights.forEach((night, i) => {
            if (i > 0) expect(DateTime.fromISO(stretch.nights[i - 1]).plus({ days: 1 }).toISODate(), "a stretch has no gaps").toBe(night);
          });
        }
        for (const o of oracle(legs, covered)) {
          if (o.state === "covered") expect(count(o.night), `${o.night} has a stay`).toBe(0);
          if (o.state === "open") expect(count(o.night), `${o.night} needs a bed`).toBe(1);
          if (o.state === "air") expect(count(o.night), `${o.night} is in the air`).toBe(1);
        }
      }),
      { numRuns: 120 },
    );
    expect(checked).toBeGreaterThanOrEqual(120);
  });
});
