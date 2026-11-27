import { describe, expect, it } from "vitest";
import { z } from "zod";
import { buildFixtureTrip } from "@/fixtures/december-trip";
import { inputToProposal } from "./quick-add";

const travelers = buildFixtureTrip().travelers;
const places = { homeZone: "America/New_York" };
const build = (raw: unknown) => inputToProposal(raw, travelers, places);

describe("quick add cases found by fuzzing, kept as examples", () => {
  it("seed 1: a plan on February 30 is a validation error, not an Invalid DateTime crash", () => {
    expect(() => build({ type: "plan", title: "Walk", city: "Tokyo", startLocal: "2026-02-30T10:00" })).toThrow(z.ZodError);
  });

  it("seed 2: a stay checking in on February 30 is a validation error", () => {
    expect(() => build({ type: "stay", name: " ", checkInDate: "2026-02-30", checkOutDate: "2026-02-30" })).toThrow(z.ZodError);
  });

  it("seed 2: hour 25 and minute 99 are validation errors", () => {
    expect(() => build({ type: "plan", title: "Walk", city: "Tokyo", startLocal: "2026-12-05T25:99" })).toThrow(z.ZodError);
    expect(() => build({ type: "stay", name: "Inn", city: "Tokyo", checkInDate: "2026-12-05", checkInTime: "99:99", checkOutDate: "2026-12-06" })).toThrow(z.ZodError);
  });

  it("seed 1: a transfer starting in year 9999 cannot slip past the end-before-start check", () => {
    expect(() => build({ type: "transfer", fromCity: "Tokyo", toCity: "Tokyo", startLocal: "9999-12-31T23:59", endLocal: "2026-03-08T02:30" })).toThrow(z.ZodError);
  });

  it("regression guard: a place nobody can locate stays flagged for review", () => {
    const p = build({ type: "plan", title: "Walk", city: "Xyzzyville", startLocal: "2026-12-05T10:00" });
    expect(p.status).toBe("needs_review");
    expect(p.problems.length).toBeGreaterThan(0);
  });
});
