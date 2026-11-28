import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { buildFixtureTrip, byFlight, fixtureItem, TRAVELERS, TRIP_ID, USERS } from "@/fixtures/december-trip";
import { present } from "@/testing/present";
import { fromLocal } from "../time/format";
import type { Item, ItemPrivate, Requester, TripAggregate } from "../types";
import { projectTrip, type TripView } from "../visibility/project";
import { riskyConnections } from "./connections";
import { smartChecks } from "./index";

const owner: Requester = { kind: "member", userId: USERS.kenny.id, homeZone: "America/New_York" };
const viewer: Requester = { kind: "member", userId: "00000000-0000-4000-8100-0000000000aa", homeZone: "America/New_York" };

interface Leg {
  id: string;
  number: string;
  airline: string;
  from: string;
  to: string;
  leaves: string;
  fromZone: string;
  lands: string;
  toZone: string;
  codes?: string[];
  travelers?: string[];
}

function flight(base: Item, leg: Leg): Item {
  const priv: ItemPrivate[] = (leg.codes ?? []).map((confirmationCode) => ({ travelerId: null, confirmationCode }));
  return {
    ...base,
    id: leg.id,
    title: leg.number,
    start: fromLocal(leg.leaves, leg.fromZone),
    end: fromLocal(leg.lands, leg.toZone),
    flight: { airline: leg.airline, flightNumber: leg.number, fromAirport: leg.from, toAirport: leg.to },
    travelerIds: leg.travelers ?? [TRAVELERS.kenny],
    private: priv,
    deadlines: [],
    visibility: "everyone",
    visibleToUserIds: [],
  };
}

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

function trip(...legs: Leg[]): { agg: TripAggregate; view: (who?: Requester) => TripView } {
  const december = buildFixtureTrip();
  const base = fixtureItem(december, byFlight("CX509"));
  const agg: TripAggregate = {
    ...december,
    items: legs.map((leg) => flight(base, leg)),
    memberships: [...december.memberships, { tripId: TRIP_ID, userId: viewer.kind === "member" ? viewer.userId : "", role: "viewer" }],
  };
  return { agg, view: (who = owner) => projectTrip(agg, who) };
}

const cx509: Leg = { id: id(1), number: "CX509", airline: "Cathay Pacific", from: "NRT", to: "HKG", leaves: "2026-12-05T08:50", fromZone: "Asia/Tokyo", lands: "2026-12-05T13:25", toZone: "Asia/Hong_Kong", codes: ["PLACEHOLDER_C"] };
const toTaipei = (over: Partial<Leg> = {}): Leg => ({ id: id(2), number: "BR892", airline: "EVA Air", from: "HKG", to: "TPE", leaves: "2026-12-05T14:20", fromZone: "Asia/Hong_Kong", lands: "2026-12-05T16:05", toZone: "Asia/Taipei", codes: ["EVA777"], ...over });

describe("a connection that is too short at one airport", () => {
  it("December: a scratch HKG to TPE at 2:20pm with a different code from CX509 reads Tight: 55 min, and Why? names both times", () => {
    const found = riskyConnections(trip(cx509, toTaipei()).view());
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({ kind: "risky_connection", itemId: id(2), itemIds: [id(1), id(2)], line: "Tight: 55 min to change planes at HKG." });
    expect(found[0]?.why).toContain("1:25pm");
    expect(found[0]?.why).toContain("2:20pm");
    expect(found[0]?.why).toContain("Most airports need about 60 to 90 minutes to connect.");
    expect(found[0]?.why).toContain("These are separate bookings, so if the first is late the second airline is not obliged to wait or rebook you.");
  });

  it("with the same booking code it is still tight but says nothing about separate bookings", () => {
    const found = riskyConnections(trip(cx509, toTaipei({ codes: ["PLACEHOLDER_C"] })).view());
    expect(found[0]?.line).toBe("Tight: 55 min to change planes at HKG.");
    expect(found[0]?.why).not.toContain("separate bookings");
  });

  it("is under the second flight and its key changes with either flight's edit time", () => {
    const { agg, view } = trip(cx509, toTaipei());
    const first = present(riskyConnections(view())[0]);
    const edited = projectTrip({ ...agg, items: agg.items.map((i) => (i.id === id(2) ? { ...i, updatedAt: "2027-01-01T00:00:00.000Z" } : i)) }, owner);
    expect(present(riskyConnections(edited)[0]).key).not.toBe(first.key);
    expect(present(riskyConnections(view())[0]).key).toBe(first.key);
  });

  it.each([
    [59, true],
    [60, false],
    [30, true],
  ])("two international flights %i minutes apart: tight is %s", (minutes, tight) => {
    const leaves = `2026-12-05T${String(13 + Math.floor((25 + minutes) / 60)).padStart(2, "0")}:${String((25 + minutes) % 60).padStart(2, "0")}`;
    const found = riskyConnections(trip(cx509, toTaipei({ leaves, lands: "2026-12-05T20:00", codes: ["PLACEHOLDER_C"] })).view());
    expect(found.some((f) => f.line.startsWith("Tight:"))).toBe(tight);
  });

  it("domestic to international needs 90 minutes, not 60", () => {
    const domestic: Leg = { id: id(1), number: "UA100", airline: "United", from: "JFK", to: "ORD", leaves: "2026-12-05T08:00", fromZone: "America/New_York", lands: "2026-12-05T09:30", toZone: "America/Chicago", codes: ["AAA111"] };
    const abroad: Leg = { id: id(2), number: "UA900", airline: "United", from: "ORD", to: "LHR", leaves: "2026-12-05T10:45", fromZone: "America/Chicago", lands: "2026-12-05T23:00", toZone: "Europe/London", codes: ["AAA111"] };
    expect(riskyConnections(trip(domestic, abroad).view())[0]?.line).toBe("Tight: 1 h 15 min to change planes at ORD.");
    expect(riskyConnections(trip(domestic, { ...abroad, leaves: "2026-12-05T11:00" }).view())).toEqual([]);
  });

  it("two domestic flights 65 minutes apart are fine", () => {
    const a: Leg = { id: id(1), number: "UA100", airline: "United", from: "JFK", to: "ORD", leaves: "2026-12-05T08:00", fromZone: "America/New_York", lands: "2026-12-05T09:30", toZone: "America/Chicago", codes: ["AAA111"] };
    const b: Leg = { id: id(2), number: "UA200", airline: "United", from: "ORD", to: "SFO", leaves: "2026-12-05T10:35", fromZone: "America/Chicago", lands: "2026-12-05T13:00", toZone: "America/Los_Angeles", codes: ["AAA111"] };
    expect(riskyConnections(trip(a, b).view())).toEqual([]);
  });
});

describe("separate bookings", () => {
  it("a different code with 2 h 10 min between reads Separate bookings, 2 h 10 min apart", () => {
    const found = riskyConnections(trip(cx509, toTaipei({ leaves: "2026-12-05T15:35", lands: "2026-12-05T17:20" })).view());
    expect(found).toHaveLength(1);
    expect(found[0]?.line).toBe("Separate bookings, 2 h 10 min apart.");
    expect(found[0]?.why).toBe("You land at Hong Kong at 1:25pm and the next flight leaves at 3:35pm. These are separate bookings, so if the first is late the second airline is not obliged to wait or rebook you.");
  });

  it("exactly 3 hours apart and the same booking say nothing", () => {
    expect(riskyConnections(trip(cx509, toTaipei({ leaves: "2026-12-05T16:25", lands: "2026-12-05T18:00" })).view())).toEqual([]);
    expect(riskyConnections(trip(cx509, toTaipei({ leaves: "2026-12-05T15:35", lands: "2026-12-05T17:20", codes: ["PLACEHOLDER_C"] })).view())).toEqual([]);
  });

  it("no code on one flight and different airlines counts as separate; the same airline does not", () => {
    expect(riskyConnections(trip(cx509, toTaipei({ leaves: "2026-12-05T15:35", lands: "2026-12-05T17:20", codes: [] })).view())[0]?.line).toBe("Separate bookings, 2 h 10 min apart.");
    expect(riskyConnections(trip(cx509, toTaipei({ leaves: "2026-12-05T15:35", lands: "2026-12-05T17:20", codes: [], airline: "Cathay Pacific" })).view())).toEqual([]);
  });

  it("codes are compared without caring about case", () => {
    expect(riskyConnections(trip(cx509, toTaipei({ leaves: "2026-12-05T15:35", lands: "2026-12-05T17:20", codes: ["placeholder_c"] })).view())).toEqual([]);
  });

  it("a viewer cannot see booking codes, so is never told two bookings are separate; the short connection still shows", () => {
    const separate = trip(cx509, toTaipei({ leaves: "2026-12-05T15:35", lands: "2026-12-05T17:20" }));
    expect(riskyConnections(separate.view(viewer))).toEqual([]);
    const tight = trip(cx509, toTaipei());
    const seen = riskyConnections(tight.view(viewer));
    expect(seen[0]?.line).toBe("Tight: 55 min to change planes at HKG.");
    expect(seen[0]?.why).not.toContain("separate bookings");
  });
});

describe("changing airports in the same city", () => {
  const lands: Leg = { id: id(1), number: "NH159", airline: "ANA", from: "JFK", to: "HND", leaves: "2026-12-01T00:55", fromZone: "America/New_York", lands: "2026-12-02T05:25", toZone: "Asia/Tokyo", codes: ["AAA111"] };
  const leaves = (at: string): Leg => ({ id: id(2), number: "NH9", airline: "ANA", from: "NRT", to: "HKG", leaves: at, fromZone: "Asia/Tokyo", lands: "2026-12-02T14:00", toZone: "Asia/Hong_Kong", codes: ["AAA111"] });

  it("Haneda to Narita in 3 h 40 min reads as in the spec", () => {
    const found = riskyConnections(trip(lands, leaves("2026-12-02T09:05")).view());
    expect(found).toHaveLength(1);
    expect(found[0]?.line).toBe("Change airports: Haneda to Narita in 3 h 40 min.");
    expect(found[0]?.why).toContain("You land at Haneda at 5:25am and the next flight leaves from Narita at 9:05am.");
  });

  it("4 hours or more is left to the existing airport switch check", () => {
    expect(riskyConnections(trip(lands, leaves("2026-12-02T09:25")).view())).toEqual([]);
  });

  it("two different cities are not an airport change", () => {
    const elsewhere: Leg = { ...leaves("2026-12-02T09:05"), from: "KIX" };
    expect(riskyConnections(trip(lands, elsewhere).view())).toEqual([]);
  });
});

describe("who and when it applies to", () => {
  it("a day or more apart is not a connection", () => {
    expect(riskyConnections(trip(cx509, toTaipei({ leaves: "2026-12-06T14:20", lands: "2026-12-06T16:05" })).view())).toEqual([]);
  });

  it("flights for different travelers are never a connection", () => {
    expect(riskyConnections(trip({ ...cx509, travelers: [TRAVELERS.kenny] }, toTaipei({ travelers: [TRAVELERS.jacob] })).view())).toEqual([]);
  });

  it("a flight that leaves before the first has landed is some other check's business", () => {
    expect(riskyConnections(trip(cx509, toTaipei({ leaves: "2026-12-05T12:00", lands: "2026-12-05T14:00" })).view())).toEqual([]);
  });

  it("only the next flight for the traveler counts, not every later one", () => {
    const third: Leg = { id: id(3), number: "BR100", airline: "EVA Air", from: "TPE", to: "BKK", leaves: "2026-12-05T16:25", fromZone: "Asia/Taipei", lands: "2026-12-05T19:00", toZone: "Asia/Bangkok", codes: ["EVA777"] };
    const found = riskyConnections(trip(cx509, toTaipei(), third).view());
    expect(found.map((f) => f.itemIds)).toEqual([
      [id(1), id(2)],
      [id(2), id(3)],
    ]);
  });

  it("the December trip as it stands raises no connection line", () => {
    expect(riskyConnections(projectTrip(buildFixtureTrip(), owner))).toEqual([]);
  });

  it("the owner's January 2027 Hong Kong trip raises none: one flight each way and a stay", () => {
    const out: Leg = { id: id(1), number: "CX841", airline: "Cathay Pacific", from: "JFK", to: "HKG", leaves: "2027-01-15T09:00", fromZone: "America/New_York", lands: "2027-01-16T14:00", toZone: "Asia/Hong_Kong", codes: ["OWN111"] };
    const back: Leg = { id: id(2), number: "CX845", airline: "Cathay Pacific", from: "HKG", to: "JFK", leaves: "2027-01-27T16:00", fromZone: "Asia/Hong_Kong", lands: "2027-01-27T19:00", toZone: "America/New_York", codes: ["OWN111"] };
    expect(smartChecks(trip(out, back).view())).toEqual([]);
  });

  it("no rule fires on a trip with no matching items", () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 6 }), (count) => {
        const spread = Array.from({ length: count }, (_, i): Leg => ({ id: id(10 + i), number: `XX${i}`, airline: "Test Air", from: "JFK", to: "LAX", leaves: `2026-12-${String(5 + i * 2).padStart(2, "0")}T08:00`, fromZone: "America/New_York", lands: `2026-12-${String(5 + i * 2).padStart(2, "0")}T11:00`, toZone: "America/Los_Angeles", codes: [`C${i}`] }));
        expect(smartChecks(trip(...spread).view())).toEqual([]);
      }),
      { numRuns: 30 },
    );
  });
});
