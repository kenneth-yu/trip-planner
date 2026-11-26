import { describe, expect, it } from "vitest";
import { buildFixtureTrip, byFlight, byTitle, fixtureItem, TRAVELERS } from "@/fixtures/december-trip";
import { inputToProposal, InputProblem } from "./quick-add";

const trip = buildFixtureTrip();
const travelers = trip.travelers;

describe("quick add input", () => {
  it("enters CX509 from local times and lands on the same instants as the fixture", () => {
    const p = inputToProposal(
      {
        type: "flight", flightNumber: "CX 509", airline: "Cathay Pacific", fromAirport: "nrt", toAirport: "HKG",
        departLocal: "2026-12-05T08:50", arriveLocal: "2026-12-05T13:25",
        seats: [{ traveler: "Kenneth", seat: "39G" }],
      },
      travelers,
    );
    const expected = fixtureItem(trip, byFlight("CX509"));
    expect([p.start, p.end]).toEqual([expected.start, expected.end]);
    expect(p.private).toEqual([{ travelerId: TRAVELERS.kenny, seat: "39G", confirmationCode: undefined }]);
    expect(p.travelerIds).toEqual([TRAVELERS.kenny, TRAVELERS.jacob]);
  });

  it("enters a stay with default times marked estimated", () => {
    const p = inputToProposal(
      { type: "stay", name: "Stanford Hotel", address: "118 Soy Street, Mong Kok, Kowloon, Hong Kong", checkInDate: "2026-12-05", checkInTime: "15:00", checkOutDate: "2026-12-06" },
      travelers,
    );
    const expected = fixtureItem(trip, byTitle("Stanford"));
    expect([p.start, p.end, p.endIsEstimated]).toEqual([expected.start, expected.end, true]);
  });

  it("refuses to guess: unknown airport, unknown city, unknown traveler", () => {
    const flight = { type: "flight", flightNumber: "XX1", fromAirport: "QQQ", toAirport: "HKG", departLocal: "2026-12-05T08:50", arriveLocal: "2026-12-05T13:25" };
    expect(() => inputToProposal(flight, travelers)).toThrow(InputProblem);
    expect(() => inputToProposal({ type: "plan", title: "Dinner", startLocal: "2026-12-05T19:00", endLocal: "2026-12-05T21:00" }, travelers)).toThrow(/which city/);
    expect(() => inputToProposal({ ...flight, fromAirport: "NRT", travelers: ["Sam"] }, travelers)).toThrow(/no traveler called "Sam"/);
  });

  it("rejects malformed times instead of reading them loosely", () => {
    expect(() => inputToProposal({ type: "plan", title: "Dinner", city: "Tokyo", startLocal: "Dec 5 7pm", endLocal: "2026-12-05T21:00" }, travelers)).toThrow();
  });
});
