import { describe, expect, it } from "vitest";
import { firstEmptyRequired } from "./first-required";

describe("where Mark as booked puts the cursor", () => {
  it("on the flight number when it is empty, then on the arrival time when that is only an estimate", () => {
    expect(firstEmptyRequired({ type: "flight", flight: { flightNumber: "" }, endIsEstimated: true })).toBe("flightNumber");
    expect(firstEmptyRequired({ type: "flight", flight: { flightNumber: "CX845" }, endIsEstimated: true })).toBe("arrives");
  });

  it("nowhere in particular when nothing required is empty, and not for a stay", () => {
    expect(firstEmptyRequired({ type: "flight", flight: { flightNumber: "CX845" }, endIsEstimated: false })).toBeNull();
    expect(firstEmptyRequired({ type: "stay", endIsEstimated: false })).toBeNull();
  });
});
