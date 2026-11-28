import { describe, expect, it } from "vitest";
import { buildFixtureTrip, FIXTURE_TODAY, USERS } from "@/fixtures/december-trip";
import { present } from "@/testing/present";
import { buildFlightCard } from "../time/flight-card";
import { projectTrip, type TripView } from "../visibility/project";
import type { Item, Requester } from "../types";
import { buildTripGrid, upNext } from "./trip-grid";

const kenny: Requester = { kind: "member", userId: USERS.kenny.id, homeZone: "America/New_York" };
const now = Date.parse(FIXTURE_TODAY);

function viewWith(change: (item: Item) => Item, pick: (i: Item) => boolean): { view: TripView; id: string } {
  const agg = buildFixtureTrip();
  const target = present(agg.items.find(pick));
  const items = agg.items.map((i) => (i.id === target.id ? change(i) : i));
  return { view: projectTrip({ ...agg, items }, kenny), id: target.id };
}

describe("the flight card for a draft", () => {
  const { view, id } = viewWith((i) => ({ ...i, booked: false }), (i) => i.type === "flight");
  const item = present(view.items.find((i) => i.id === id));

  it("keeps the flight number and says it is not booked yet", () => {
    expect(buildFlightCard(item, "America/New_York").header).toMatch(/ · not booked yet$/);
    expect(buildFlightCard(item, "America/New_York").header).toContain(item.flight?.flightNumber ?? "never");
  });

  it("without a flight number reads Not booked yet and the place it lands", () => {
    const card = buildFlightCard({ ...item, flight: present(item.flight) && { ...present(item.flight), flightNumber: "", airline: undefined } }, "America/New_York");
    expect(card.header).toBe(`Not booked yet · ${card.arrive.city}`);
  });

  it("a booked flight reads as before", () => {
    expect(buildFlightCard({ ...item, booked: true }, "America/New_York").header).not.toContain("not booked yet");
  });
});

describe("drafts on the grid and in Up next", () => {
  const plan = viewWith((i) => ({ ...i, booked: false }), (i) => i.type === "plan" && i.status === "confirmed");
  const grid = present(buildTripGrid(plan.view, now));

  it("marks a draft plan bubble, and only that one", () => {
    const entries = grid.plans.flat().filter((p) => p.itemId !== null);
    expect(entries.filter((p) => p.draft).map((p) => p.itemId)).toEqual([plan.id]);
  });

  it("marks a draft flight's departure and landing", () => {
    const flight = viewWith((i) => ({ ...i, booked: false }), (i) => i.type === "flight");
    const travel = present(buildTripGrid(flight.view, now)).travel.flat().filter((t) => t.itemId === flight.id);
    expect(travel.length).toBeGreaterThan(0);
    expect(travel.every((t) => t.draft)).toBe(true);
  });

  it("marks a draft stay's sleeping block only when every stay in it is a draft", () => {
    const stay = viewWith((i) => ({ ...i, booked: false }), (i) => i.type === "stay" && i.status === "confirmed");
    const spans = present(buildTripGrid(stay.view, now)).sleep;
    expect(spans.some((s) => s.draft)).toBe(true);
    expect(spans.some((s) => !s.draft)).toBe(true);
  });

  it("names a draft flight with no number by what it is, not by its title, in the grid and in Up next", () => {
    const numberless = viewWith(
      (i) => ({ ...i, booked: false, title: "JFK to HKG", flight: i.flight && { ...i.flight, flightNumber: "", airline: undefined } }),
      (i) => i.type === "flight",
    );
    const travel = present(buildTripGrid(numberless.view, now)).travel.flat().filter((t) => t.itemId === numberless.id && t.kind === "departs");
    expect(travel.map((t) => t.title)).toEqual([expect.stringMatching(/^Flight to \w/)]);
    for (const t of travel) expect(t.title).not.toContain("JFK to HKG");
    const next = upNext(numberless.view, 0, 20).filter((e) => e.itemId === numberless.id);
    expect(next[0].title).toMatch(/^Flight to \w/);
    expect(next[0].title).not.toContain("JFK to HKG");
  });

  it("says in Up next that a draft is not booked", () => {
    const flight = viewWith((i) => ({ ...i, booked: false }), (i) => i.type === "flight");
    const entries = upNext(flight.view, 0, 20).filter((e) => e.itemId === flight.id);
    expect(entries.length).toBeGreaterThan(0);
    expect(entries.every((e) => e.draft)).toBe(true);
    expect(upNext(plan.view, 0, 20).filter((e) => e.itemId !== plan.id).every((e) => !e.draft)).toBe(true);
  });
});
