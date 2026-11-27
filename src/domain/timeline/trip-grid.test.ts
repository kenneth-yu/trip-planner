import { describe, expect, it } from "vitest";
import { buildFixtureTrip, FIXTURE_TODAY, TRIP_ID, USERS } from "@/fixtures/december-trip";
import { present } from "@/testing/present";
import { projectTrip } from "../visibility/project";
import { DateTime } from "../time/luxon";
import { fromLocal } from "../time/format";
import { buildTripGrid, tripSpan } from "./trip-grid";

const NY = "America/New_York";
const now = new Date(FIXTURE_TODAY).getTime();
const kenny = { kind: "member" as const, userId: USERS.kenny.id, homeZone: NY };
const view = projectTrip(buildFixtureTrip(), kenny);
const grid = present(buildTripGrid(view, now));
const col = (key: string) => grid.days.findIndex((d) => d.key === key);

describe("trip grid on the fixture trip", () => {
  it("has one equal column per day, Tue Dec 1 to Tue Dec 15", () => {
    expect(grid.days.map((d) => `${d.weekday} ${d.day}`)).toEqual([
      "Tue 1", "Wed 2", "Thu 3", "Fri 4", "Sat 5", "Sun 6", "Mon 7", "Tue 8", "Wed 9", "Thu 10", "Fri 11", "Sat 12", "Sun 13", "Mon 14", "Tue 15",
    ]);
    expect(grid.days[0].month).toBe("Dec");
    expect(grid.days[1].month).toBeNull();
    expect(grid.days.filter((d) => d.weekend).map((d) => d.day)).toEqual(["5", "6", "12", "13"]);
  });

  it("reads as a route", () => {
    expect(grid.route).toEqual(["New York", "Tokyo", "Hong Kong", "Shenzhen", "Hong Kong", "Tokyo", "New York"]);
  });

  it("shows where you sleep each night as city blocks over the nights", () => {
    expect(grid.sleep.map((s) => [s.city, grid.days[s.from].day, s.nights, s.cityIndex])).toEqual([
      ["Tokyo", "2", 3, 0],
      ["Hong Kong", "5", 1, 1],
      ["Shenzhen", "6", 4, 2],
      ["Hong Kong", "10", 3, 1],
      ["Tokyo", "13", 2, 0],
    ]);
  });

  it("lists travel on the day it happens, with local times", () => {
    const at = (key: string) => grid.travel[col(key)].map((t) => [t.title, t.time]);
    expect(at("2026-12-01")).toEqual([["NH159 to Tokyo", "leaves 12:55am"]]);
    expect(at("2026-12-02")).toEqual([["Land in Tokyo", "5:25am, clocks +14h"]]);
    expect(at("2026-12-05")).toEqual([
      ["CX509 to Hong Kong", "leaves 8:50am"],
      ["Land in Hong Kong", "1:25pm, clocks -1h"],
    ]);
    expect(at("2026-12-15")).toEqual([
      ["NH160 to New York", "leaves 10:55pm"],
      ["Land in New York", "9:55pm, clocks -14h"],
    ]);
  });

  it("flags missing transport on the day you move", () => {
    const missing = grid.travel.flatMap((cell, i) => cell.filter((t) => t.kind === "missing").map((t) => [grid.days[i].day, t.title]));
    expect(missing).toEqual([
      ["6", "No way to Shenzhen booked"],
      ["10", "No way to Hong Kong booked"],
    ]);
  });

  it("puts plans in their day, in time order", () => {
    expect(grid.plans[col("2026-12-02")].map((p) => `${p.time} ${p.title}`)).toEqual(["6:30pm Head spa"]);
    expect(grid.plans[col("2026-12-05")].map((p) => `${p.time} ${p.title}`)).toEqual(["5:00pm Jantzen Tailor", "6:45pm Sun Kai Tat"]);
  });

  it("keeps the unclear stay apart, over its nights", () => {
    expect(grid.unsure.map((u) => [u.title, grid.days[u.from].day, u.to - u.from])).toEqual([["Stay at Total (USD) $1,183.22", "10", 4]]);
  });

  it("shows a hidden item only as Busy", () => {
    const agg = buildFixtureTrip();
    const base = present(agg.items.find((i) => i.type === "plan"));
    agg.items.push({
      ...base, id: "item-secret", title: "Ring shopping", createdBy: USERS.jacob.id, visibility: "only_me", showAsBusy: true,
      start: fromLocal("2026-12-11T15:00", "Asia/Hong_Kong"), end: fromLocal("2026-12-11T16:00", "Asia/Hong_Kong"),
    });
    const g = present(buildTripGrid(projectTrip(agg, kenny), now));
    expect(g.plans[g.days.findIndex((d) => d.key === "2026-12-11")].map((p) => p.title)).toEqual(["Busy"]);
    expect(JSON.stringify(g)).not.toContain("Ring");
  });

  it("marks today during the trip only", () => {
    expect(grid.days.some((d) => d.today)).toBe(false);
    const during = present(buildTripGrid(view, DateTime.fromISO("2026-12-07T12:00", { zone: "Asia/Shanghai" }).toMillis()));
    expect(during.days.filter((d) => d.today).map((d) => d.day)).toEqual(["7"]);
  });

  it("gives a viewer the same grid of what they may see", () => {
    const agg = buildFixtureTrip();
    agg.memberships.push({ tripId: TRIP_ID, userId: "user-mom", role: "viewer" });
    expect(present(buildTripGrid(projectTrip(agg, { kind: "member", userId: "user-mom", homeZone: NY }), now)).route).toEqual(grid.route);
  });

  it("summarizes dates with a friendly countdown", () => {
    expect(tripSpan(view, now)).toEqual({ dates: "Dec 1 to 15", countdown: "You leave in 5 days" });
  });
});
