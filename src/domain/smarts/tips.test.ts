import { describe, expect, it } from "vitest";
import { buildFixtureTrip, byFlight, fixtureItem, TRAVELERS, USERS } from "@/fixtures/december-trip";
import { present } from "@/testing/present";
import { fromLocal, toLocal } from "../time/format";
import type { Item, Requester, TripAggregate } from "../types";
import { projectTrip, type TripView } from "../visibility/project";
import { bagTips, leaveByTips, smartTips } from "./tips";

const owner: Requester = { kind: "member", userId: USERS.kenny.id, homeZone: "America/New_York" };
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

interface FlightSpec {
  id: string;
  number: string;
  from: string;
  to: string;
  leaves: string;
  fromZone: string;
  lands: string;
  toZone: string;
  travelers?: string[];
}

interface StaySpec {
  id: string;
  name: string;
  city: string;
  zone: string;
  checkIn: string;
  checkOut: string;
  minutes?: number;
  estimated?: boolean;
  travelers?: string[];
}

const december = buildFixtureTrip();
const flightBase = fixtureItem(december, byFlight("CX509"));
const stayBase = present(december.items.find((i) => i.type === "stay"));

function flight(spec: FlightSpec): Item {
  return {
    ...flightBase,
    id: spec.id,
    title: spec.number,
    start: fromLocal(spec.leaves, spec.fromZone),
    end: fromLocal(spec.lands, spec.toZone),
    flight: { airline: "Cathay Pacific", flightNumber: spec.number, fromAirport: spec.from, toAirport: spec.to },
    travelerIds: spec.travelers ?? [TRAVELERS.kenny],
    private: [],
    deadlines: [],
    visibility: "everyone",
    visibleToUserIds: [],
  };
}

function stay(spec: StaySpec): Item {
  return {
    ...stayBase,
    id: spec.id,
    title: spec.name,
    start: fromLocal(spec.checkIn, spec.zone),
    end: fromLocal(spec.checkOut, spec.zone),
    startIsEstimated: spec.estimated ?? true,
    endIsEstimated: spec.estimated ?? true,
    location: { name: spec.name, city: spec.city },
    stay: { propertyName: spec.name, kind: "hotel", ...(spec.minutes ? { timeToAirportMinutes: spec.minutes } : {}) },
    travelerIds: spec.travelers ?? [TRAVELERS.kenny],
    private: [],
    deadlines: [],
    visibility: "everyone",
    visibleToUserIds: [],
  };
}

function view(items: Item[], who: Requester = owner): TripView {
  const agg: TripAggregate = { ...december, items };
  return projectTrip(agg, who);
}

const out: FlightSpec = { id: id(1), number: "CX841", from: "JFK", to: "HKG", leaves: "2027-01-15T09:00", fromZone: "America/New_York", lands: "2027-01-16T14:00", toZone: "Asia/Hong_Kong" };
const back: FlightSpec = { id: id(2), number: "CX845", from: "HKG", to: "JFK", leaves: "2027-01-27T16:00", fromZone: "Asia/Hong_Kong", lands: "2027-01-27T19:00", toZone: "America/New_York" };
const hotel = (over: Partial<StaySpec> = {}): StaySpec => ({ id: id(3), name: "Hotel Resol", city: "Hong Kong", zone: "Asia/Hong_Kong", checkIn: "2027-01-16T15:00", checkOut: "2027-01-27T11:00", ...over });

describe("the days in the owner's January 2027 cases", () => {
  it("the flight home leaves on a Wednesday, Jan 27, and the outbound lands on a Saturday, Jan 16", () => {
    expect(toLocal(flight(back).start).toFormat("ccc LLL d")).toBe("Wed Jan 27");
    expect(toLocal(flight(out).end).toFormat("ccc LLL d")).toBe("Sat Jan 16");
    expect(toLocal(stay(hotel()).start).toFormat("ccc LLL d")).toBe("Sat Jan 16");
    expect(toLocal(stay(hotel()).end).toFormat("ccc LLL d")).toBe("Wed Jan 27");
  });

  it("each tip sits on the day its test name says", () => {
    const all = smartTips(view([flight(out), flight(back), stay(hotel({ minutes: 60 }))]));
    const days = all.map((t) => {
      const item = present(view([flight(out), flight(back), stay(hotel())]).items.find((i) => i.id === t.itemId));
      return `${t.row} ${toLocal(t.row === "check_in" ? item.start : t.row === "check_out" ? item.end : item.start).toFormat("ccc LLL d")}`;
    });
    expect(days).toEqual(["flight Wed Jan 27"]);
  });
});

describe("leave the hotel by (the owner's January 2027 trip)", () => {
  it("with a time to the airport of 1 hour, Wed Jan 27 says Leave the hotel by noon (UX-4 words 12:00pm that way), under the return flight", () => {
    const found = leaveByTips(view([flight(out), flight(back), stay(hotel({ minutes: 60 }))]));
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({ kind: "airport", itemId: id(2), row: "flight", line: "Leave the hotel by noon." });
    expect(found[0]?.why).toBe("CX 845 leaves Hong Kong at 4:00pm. Airlines suggest arriving about 3 hours before an international flight. Hotel Resol to the airport takes about 1 hour (your estimate).");
  });

  it("without it, the line reads Be at the airport by 1:00pm and Why? says how to get a leave time", () => {
    const found = leaveByTips(view([flight(out), flight(back), stay(hotel())]));
    expect(found[0]?.line).toBe("Be at the airport by 1:00pm.");
    expect(found[0]?.why).toBe("CX 845 leaves Hong Kong at 4:00pm. Airlines suggest arriving about 3 hours before an international flight. Add how long it takes to get there on the stay, and this will say when to leave.");
  });

  it.each([
    [45, "Leave the hotel by 12:15pm.", "about 45 minutes"],
    [90, "Leave the hotel by 11:30am.", "about 1 hour 30 minutes"],
    [120, "Leave the hotel by 11:00am.", "about 2 hours"],
  ])("a time to the airport of %i minutes reads %j", (minutes, line, words) => {
    const found = leaveByTips(view([flight(back), stay(hotel({ minutes }))]));
    expect(found[0]?.line).toBe(line);
    expect(found[0]?.why).toContain(`takes ${words} (your estimate)`);
  });

  it("a domestic flight uses 2 hours", () => {
    const domestic: FlightSpec = { id: id(5), number: "UA100", from: "JFK", to: "ORD", leaves: "2027-02-10T15:00", fromZone: "America/New_York", lands: "2027-02-10T16:30", toZone: "America/Chicago" };
    const found = leaveByTips(view([flight(domestic), stay(hotel({ name: "Chelsea Pines", city: "New York", zone: "America/New_York", checkIn: "2027-02-08T15:00", checkOut: "2027-02-10T11:00" }))]));
    expect(found[0]?.line).toBe("Be at the airport by 1:00pm.");
    expect(found[0]?.why).toContain("about 2 hours before a domestic flight");
  });

  it("works from a stay that covers the night before when the check-out is a day later", () => {
    const found = leaveByTips(view([flight(back), stay(hotel({ checkOut: "2027-01-28T11:00" }))]));
    expect(found).toHaveLength(1);
  });

  it.each([
    ["no stay in that city", [flight(back), stay(hotel({ city: "Tokyo", zone: "Asia/Tokyo" }))]],
    ["a stay that ended days before", [flight(back), stay(hotel({ checkOut: "2027-01-24T11:00" }))]],
    ["a stay for someone else", [flight(back), stay(hotel({ travelers: [TRAVELERS.jacob] }))]],
    ["no stay at all", [flight(back)]],
  ])("shows nothing with %s", (_name, items) => {
    expect(leaveByTips(view(items))).toEqual([]);
  });

  it("is not on the arriving flight", () => {
    expect(leaveByTips(view([flight(out), stay(hotel())])).map((t) => t.itemId)).toEqual([]);
  });

  it("keys change when the stay is edited, so hiding survives nothing but the same data", () => {
    const first = present(leaveByTips(view([flight(back), stay(hotel({ minutes: 60 }))]))[0]);
    const edited = present(leaveByTips(view([flight(back), { ...stay(hotel({ minutes: 90 })), updatedAt: "2027-01-01T00:00:00.000Z" }]))[0]);
    expect(edited.key).not.toBe(first.key);
  });
});

describe("gaps around check-in and check-out", () => {
  it("Wed Jan 27 check-out reads 2 hours between check-out and leaving (11:00am out, leaving at 1:00pm)", () => {
    const found = bagTips(view([flight(out), flight(back), stay(hotel())]));
    const gap = found.find((t) => t.row === "check_out");
    expect(gap).toMatchObject({ kind: "bags", itemId: id(3), line: "2 hours between check-out and leaving. Store your bags?" });
    expect(gap?.why).toBe("Check-out is usually 11:00am, and you leave for the airport around 1:00pm. Most hotels hold bags at the front desk after check-out, or ask about a late check-out.");
  });

  it("a time to the airport moves the leaving time earlier and can remove the gap", () => {
    expect(bagTips(view([flight(back), stay(hotel({ minutes: 60 }))])).filter((t) => t.row === "check_out")).toEqual([]);
    expect(bagTips(view([flight(back), stay(hotel({ minutes: 30 }))])).filter((t) => t.row === "check_out")).toEqual([]);
    expect(bagTips(view([flight({ ...back, leaves: "2027-01-27T16:30" }), stay(hotel({ minutes: 30 }))])).filter((t) => t.row === "check_out")[0]?.line).toBe("2 hours between check-out and leaving. Store your bags?");
  });

  it("Sat Jan 16: ready about 3:30pm after a 2:00pm landing, check-in at 3:00pm: nothing on arrival", () => {
    expect(bagTips(view([flight(out), flight(back), stay(hotel())])).filter((t) => t.row === "check_in")).toEqual([]);
  });

  it("landing at 9:00am gives About 4 hours before check-in, with the landing and ready times in Why?", () => {
    const early: FlightSpec = { ...out, lands: "2027-01-16T09:00" };
    const found = bagTips(view([flight(early), stay(hotel())])).filter((t) => t.row === "check_in");
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({ itemId: id(3), line: "About 4 hours before check-in. Store your bags?" });
    expect(found[0]?.why).toBe("You land at 9:00am and should be at Hotel Resol around 10:30am. Check-in is usually from 3:00pm. Most hotels hold bags at the front desk, or ask for an early check-in.");
  });

  it("a confirmed check-in time is not called usual", () => {
    const early: FlightSpec = { ...out, lands: "2027-01-16T09:00" };
    const found = bagTips(view([flight(early), stay(hotel({ estimated: false }))])).filter((t) => t.row === "check_in");
    expect(found[0]?.why).toContain("Check-in is from 3:00pm.");
  });

  it("a domestic landing needs only 45 minutes to be ready", () => {
    const domestic: FlightSpec = { id: id(6), number: "UA200", from: "ORD", to: "JFK", leaves: "2027-02-08T05:00", fromZone: "America/Chicago", lands: "2027-02-08T08:30", toZone: "America/New_York" };
    const found = bagTips(view([flight(domestic), stay(hotel({ name: "Chelsea Pines", city: "New York", zone: "America/New_York", checkIn: "2027-02-08T15:00", checkOut: "2027-02-10T11:00" }))])).filter((t) => t.row === "check_in");
    expect(found[0]?.why).toContain("around 9:15am");
    expect(found[0]?.line).toBe("About 5 hours before check-in. Store your bags?");
  });

  it.each([
    ["landing on the day before check-in", [flight({ ...out, lands: "2027-01-15T09:00" }), stay(hotel())]],
    ["a flight into another city", [flight({ ...out, to: "TPE", toZone: "Asia/Taipei" }), stay(hotel())]],
    ["no flights", [stay(hotel())]],
  ])("shows nothing on arrival with %s", (_name, items) => {
    expect(bagTips(view(items)).filter((t) => t.row === "check_in")).toEqual([]);
  });

  it("an early flight that leaves before check-out has no gap", () => {
    const early: FlightSpec = { ...back, leaves: "2027-01-27T09:00" };
    expect(bagTips(view([flight(early), stay(hotel())])).filter((t) => t.row === "check_out")).toEqual([]);
  });
});

describe("who sees tips and what stays quiet", () => {
  it("on the December trip every tip belongs to a flight or stay that is on the trip", () => {
    const trip = projectTrip(december, owner);
    const ids = new Set(trip.items.map((i) => i.id));
    for (const tip of smartTips(trip)) for (const itemId of tip.itemIds) expect(ids.has(itemId)).toBe(true);
  });

  it("quiet on a trip with no flights or stays", () => {
    expect(smartTips(view([]))).toEqual([]);
  });
});
