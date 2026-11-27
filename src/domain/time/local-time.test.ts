import { describe, expect, it } from "vitest";
import { buildFixtureTrip } from "@/fixtures/december-trip";
import { inputToProposal } from "../import/quick-add";
import { localTimeFlag, localTimeProblem } from "./local-time";

const travelers = buildFixtureTrip().travelers;
const places = { homeZone: "America/New_York" };

describe("local times that are ambiguous or do not exist", () => {
  it("knows a time that repeats when the clocks go back", () => {
    expect(localTimeProblem("2026-11-01T01:30", "America/New_York")).toBe("repeats");
    expect(localTimeProblem("2026-11-01T02:30", "America/New_York")).toBeNull();
  });

  it("knows a time that is skipped when the clocks go forward", () => {
    expect(localTimeProblem("2027-03-14T02:30", "America/New_York")).toBe("skipped");
    expect(localTimeProblem("2027-03-14T03:30", "America/New_York")).toBeNull();
  });

  it("has nothing to say about an ordinary time, or a zone without clock changes", () => {
    expect(localTimeProblem("2026-12-05T08:50", "Asia/Tokyo")).toBeNull();
    expect(localTimeProblem("2026-11-01T01:30", "Asia/Tokyo")).toBeNull();
  });

  it("flags a flight that departs in the repeated hour instead of choosing silently", () => {
    const p = inputToProposal(
      { type: "flight", flightNumber: "UA 1", fromAirport: "JFK", toAirport: "ORD", departLocal: "2026-11-01T01:30", arriveLocal: "2026-11-01T04:10" },
      travelers,
      places,
    );
    expect(p.status).toBe("needs_review");
    expect(p.problems).toEqual([localTimeFlag("repeats", "2026-11-01T01:30", "Departure at")]);
    expect(p.problems[0]).toContain("happens twice");
  });

  it("flags a stay whose check in time does not exist, and leaves ordinary bookings clean", () => {
    const skipped = inputToProposal(
      { type: "stay", name: "Hotel Resol Ueno", city: "New York", checkInDate: "2027-03-14", checkInTime: "02:30", checkOutDate: "2027-03-16" },
      travelers,
      places,
    );
    expect(skipped.status).toBe("needs_review");
    expect(skipped.problems.join(" ")).toContain("does not exist");
    const clean = inputToProposal(
      { type: "flight", flightNumber: "NH 159", fromAirport: "JFK", toAirport: "HND", departLocal: "2026-12-01T00:55", arriveLocal: "2026-12-02T05:25" },
      travelers,
      places,
    );
    expect(clean.status).toBe("confirmed");
    expect(clean.problems).toEqual([]);
  });
});
