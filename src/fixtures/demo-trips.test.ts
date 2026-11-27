import { describe, expect, it } from "vitest";
import { present } from "@/testing/present";
import { projectTrip } from "@/domain/visibility/project";
import { buildTripGrid } from "@/domain/timeline/trip-grid";
import { buildDays, groupFreeDays } from "@/domain/time/days";
import { runChecks } from "@/domain/checks/checks";
import { buildDemoTrip, EMPTY_TRIP, PACKED_TRIP, SPARSE_TRIP } from "./demo-trips";
import { USERS } from "./december-trip";

const NY = "America/New_York";
const kenny = { kind: "member" as const, userId: USERS.kenny.id, homeZone: NY };
const now = new Date("2026-11-26T12:00:00-05:00").getTime();
const viewOf = (spec: typeof EMPTY_TRIP) => projectTrip(buildDemoTrip(spec), kenny);

describe("empty trip", () => {
  it("has nothing to draw", () => {
    const view = viewOf(EMPTY_TRIP);
    expect(view.items).toEqual([]);
    expect(buildTripGrid(view, now)).toBeNull();
    expect(buildDays(view)).toEqual([]);
  });
});

describe("sparse trip", () => {
  const view = viewOf(SPARSE_TRIP);
  const grid = present(buildTripGrid(view, now));

  it("is a weekend with one stay and two flights", () => {
    expect(grid.days.map((d) => `${d.weekday} ${d.day}`)).toEqual(["Fri 16", "Sat 17", "Sun 18"]);
    expect(grid.sleep.map((s) => [s.city, s.nights])).toEqual([["Chicago", 2]]);
    expect(grid.plans.every((p) => p.length === 0)).toBe(true);
  });

  it("calls the middle day free", () => {
    expect(groupFreeDays(buildDays(view)).filter((g) => g.isFree).map((g) => g.header)).toEqual(["Sat Apr 17"]);
  });
});

describe("packed trip", () => {
  const view = viewOf(PACKED_TRIP);
  const grid = present(buildTripGrid(view, now));
  const perDay = grid.plans.map((p) => p.length);

  it("has many events a day", () => {
    expect(view.items.length).toBeGreaterThanOrEqual(35);
    expect(Math.max(...perDay)).toBeGreaterThanOrEqual(8);
  });

  it("routes through Tokyo and Kyoto by train, and back", () => {
    expect(grid.route).toEqual(["New York", "Tokyo", "Kyoto", "Tokyo", "New York"]);
    expect(grid.travel.flat().filter((t) => t.kind === "transfer").map((t) => t.title)).toEqual(["Nozomi 17 to Kyoto", "Nozomi 208 to Tokyo"]);
    expect(grid.travel.flat().filter((t) => t.kind === "missing")).toEqual([]);
  });

  it("shows Jacob's hidden plan to Kenny only as Busy", () => {
    expect(grid.plans.flat().filter((p) => p.title === "Busy")).toHaveLength(1);
    expect(JSON.stringify(grid)).not.toContain("Ring shopping");
  });

  it("keeps the unclear booking apart and flags it as an overlap", () => {
    expect(grid.unsure.map((u) => u.title)).toEqual(["Stay at Booking.com reservation 4471"]);
    expect(runChecks(view).some((f) => f.kind === "overlapping_stays")).toBe(true);
  });

  it("flies home on the day US clocks change, and the landing says so", () => {
    const sunday = grid.travel[grid.days.findIndex((d) => d.key === "2027-03-14")];
    expect(sunday.map((t) => `${t.title} ${t.time}`)).toContain("Land in New York 10:55am, clocks -13h");
  });
});
