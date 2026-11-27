import { describe, expect, it } from "vitest";
import { buildFixtureTrip, byFlight, byTitle, fixtureItem, TRAVELERS } from "@/fixtures/december-trip";
import { inputToProposal, InputProblem } from "./quick-add";

const trip = buildFixtureTrip();
const travelers = trip.travelers;
const places = { homeZone: "America/New_York" };

describe("quick add input", () => {
  it("enters CX509 from local times and lands on the same instants as the fixture", () => {
    const p = inputToProposal(
      {
        type: "flight", flightNumber: "CX 509", airline: "Cathay Pacific", fromAirport: "nrt", toAirport: "HKG",
        departLocal: "2026-12-05T08:50", arriveLocal: "2026-12-05T13:25",
        seats: [{ traveler: "Kenneth", seat: "39G" }],
      },
      travelers,
      places,
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
      places,
    );
    const expected = fixtureItem(trip, byTitle("Stanford"));
    expect([p.start, p.end, p.endIsEstimated]).toEqual([expected.start, expected.end, true]);
  });

  it("refuses typos it cannot fix: unknown airport codes and travelers", () => {
    const flight = { type: "flight", flightNumber: "XX1", fromAirport: "QQQ", toAirport: "HKG", departLocal: "2026-12-05T08:50", arriveLocal: "2026-12-05T13:25" };
    expect(() => inputToProposal(flight, travelers, places)).toThrow(InputProblem);
    expect(() => inputToProposal({ ...flight, fromAirport: "NRT", travelers: ["Sam"] }, travelers, places)).toThrow(/no traveler called "Sam"/);
  });

  it("accepts a place it cannot pin down, uses the trip's time that day, and flags it", () => {
    const p = inputToProposal(
      { type: "plan", title: "Dinner", startLocal: "2026-12-05T19:00", endLocal: "2026-12-05T21:00" },
      travelers,
      { homeZone: "America/New_York", zoneOnDate: (d) => (d === "2026-12-05" ? "Asia/Hong_Kong" : null) },
    );
    expect(p.start.zone).toBe("Asia/Hong_Kong");
    expect(p.status).toBe("needs_review");
    expect(p.problems).toEqual(["We could not tell where this place is. Add the city and country. Times use the trip's local time that day until then."]);
  });

  it("uses an address lookup when the name alone is not enough", () => {
    const p = inputToProposal(
      { type: "plan", title: "Omakase", address: "3 Chome-2-15 Nishiazabu, Minato City", startLocal: "2026-12-03T19:00", endLocal: "2026-12-03T21:00" },
      travelers,
      { homeZone: "America/New_York", geocode: () => ({ lat: 35.66, lng: 139.72, label: "Nishiazabu, Minato, Tokyo, Japan" }) },
    );
    expect([p.start.zone, p.status, p.problems]).toEqual(["Asia/Tokyo", "confirmed", []]);
  });

  it("places a city with no airport by its country, when the country has one time zone", () => {
    const p = inputToProposal({ type: "plan", title: "Fushimi Inari", city: "Kyoto", country: "Japan", startLocal: "2027-03-12T07:00", endLocal: "2027-03-12T09:00" }, travelers, places);
    expect([p.start.zone, p.location?.city]).toEqual(["Asia/Tokyo", "Kyoto"]);
    const fromAddress = inputToProposal({ type: "plan", title: "Tea ceremony", address: "Higashiyama-ku, Kyoto, Japan", startLocal: "2027-03-12T14:00", endLocal: "2027-03-12T15:00" }, travelers, places);
    expect(fromAddress.start.zone).toBe("Asia/Tokyo");
    const springfield = inputToProposal({ type: "plan", title: "Somewhere", city: "Springfield", country: "United States", startLocal: "2027-03-12T14:00", endLocal: "2027-03-12T15:00" }, travelers, places);
    expect(springfield.status).toBe("needs_review");
    expect(springfield.problems[0]).toMatch(/several places called Springfield/);
  });

  it("rejects malformed times instead of reading them loosely", () => {
    expect(() => inputToProposal({ type: "plan", title: "Dinner", city: "Tokyo", startLocal: "Dec 5 7pm", endLocal: "2026-12-05T21:00" }, travelers, places)).toThrow();
  });
});
