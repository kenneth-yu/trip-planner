import { describe, expect, it } from "vitest";
import { buildFixtureTrip, FIXTURE_TODAY, TRIP_ID, USERS } from "@/fixtures/december-trip";
import { present } from "@/testing/present";
import { projectTrip } from "../visibility/project";
import { DateTime } from "../time/luxon";
import { fromLocal } from "../time/format";
import { buildTripGrid, dayStrip, pickDay, spanText, tripSpan, upNext } from "./trip-grid";

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

  it("opens on the day you asked for, else today, else the first day", () => {
    expect(pickDay(grid.days, "2026-12-05")).toBe("2026-12-05");
    expect(pickDay(grid.days, "2027-01-01")).toBe("2026-12-01");
    expect(pickDay(grid.days, null)).toBe("2026-12-01");
    const during = present(buildTripGrid(view, DateTime.fromISO("2026-12-07T12:00", { zone: "Asia/Shanghai" }).toMillis()));
    expect(pickDay(during.days, null)).toBe("2026-12-07");
    expect(pickDay([], null)).toBeNull();
  });

  it("summarizes dates with a friendly countdown", () => {
    expect(tripSpan(view, now)).toEqual({ dates: "Dec 1 to 15", countdown: "You leave in 5 days", planning: false });
  });

  describe("the planning line", () => {
    const drafted = (every: boolean) => ({ ...view, items: view.items.map((item, index) => ({ ...item, booked: every ? false : index !== 0 })) });

    it("reads Planning and the dates, in place of the countdown, when every item is not booked yet", () => {
      const span = present(tripSpan(drafted(true), now));
      expect(span).toEqual({ dates: "Dec 1 to 15", countdown: null, planning: true });
      expect(spanText(span)).toBe("Planning, Dec 1 to 15");
    });

    it("goes back to the normal line the moment one item is booked", () => {
      const span = present(tripSpan(drafted(false), now));
      expect(span.planning).toBe(false);
      expect(spanText(span)).toBe("Dec 1 to 15 · You leave in 5 days");
    });

    it("stays on Planning while the dates have not been booked, even when they have already begun or passed", () => {
      const during = DateTime.fromISO("2026-12-07T12:00", { zone: "Asia/Shanghai" }).toMillis();
      const after = DateTime.fromISO("2027-02-01T12:00", { zone: "Asia/Shanghai" }).toMillis();
      for (const at of [during, after]) expect(spanText(present(tripSpan(drafted(true), at)))).toBe("Planning, Dec 1 to 15");
    });

    it("says the dates across two months, as the normal line does", () => {
      const span = present(tripSpan({ ...drafted(true), items: drafted(true).items.filter((i) => i.start.at < "2026-12-02T00:00:00Z" || i.end.at > "2026-12-14T00:00:00Z") }, now));
      expect(spanText(span)).toMatch(/^Planning, [A-Z][a-z]{2} \d+ to \d+$/);
    });

    it("goes through the projection: the editor of an all-draft trip sees Planning, an invited viewer and a link visitor see no line at all", () => {
      const agg = buildFixtureTrip();
      for (const item of agg.items) item.booked = false;
      agg.memberships.push({ tripId: TRIP_ID, userId: "user-mom", role: "viewer" });
      agg.shareLink = { enabled: true, showsDeadlines: false };
      const owner = projectTrip(agg, kenny);
      expect(spanText(present(tripSpan(owner, now)))).toBe("Planning, Dec 1 to 15");
      expect(tripSpan(projectTrip(agg, { kind: "member", userId: "user-mom", homeZone: NY }), now)).toBeNull();
      expect(tripSpan(projectTrip(agg, { kind: "link", homeZone: NY }), now)).toBeNull();
    });

    it("keeps the normal line for an invited viewer when only some items are not booked", () => {
      const agg = buildFixtureTrip();
      agg.items[0].booked = false;
      agg.memberships.push({ tripId: TRIP_ID, userId: "user-mom", role: "viewer" });
      const span = present(tripSpan(projectTrip(agg, { kind: "member", userId: "user-mom", homeZone: NY }), now));
      expect(span.planning).toBe(false);
      expect(spanText(span)).toMatch(/^[A-Z][a-z]{2} \d+ to .+ · You leave in \d+ days$/);
    });

    it("shows nothing for a trip with no items, planning or not", () => {
      expect(tripSpan({ ...view, items: [] }, now)).toBeNull();
    });
  });

  it("writes the normal line with the countdown after the dates, and the dates alone when there is none", () => {
    expect(spanText({ dates: "Dec 1 to 15", countdown: "You leave in 5 days", planning: false })).toBe("Dec 1 to 15 · You leave in 5 days");
    expect(spanText({ dates: "Dec 1 to 15", countdown: null, planning: false })).toBe("Dec 1 to 15");
  });
});

describe("day strip for phones", () => {
  const strip = dayStrip(grid);

  it("has one chip per day with the city you sleep in that night", () => {
    expect(strip.map((d) => `${d.day} ${d.city ?? "-"}`)).toEqual([
      "1 -", "2 Tokyo", "3 Tokyo", "4 Tokyo", "5 Hong Kong", "6 Shenzhen", "7 Shenzhen", "8 Shenzhen", "9 Shenzhen",
      "10 Hong Kong", "11 Hong Kong", "12 Hong Kong", "13 Tokyo", "14 Tokyo", "15 -",
    ]);
  });

  it("marks days with something on them and days that need attention", () => {
    expect(strip.filter((d) => d.busy).map((d) => d.day)).toEqual(["1", "2", "5", "13", "15"]);
    expect(strip.filter((d) => d.needsAttention).map((d) => d.day)).toEqual(["6", "10", "11", "12", "13"]);
  });
});

describe("up next", () => {
  it("before the trip: the first things to happen, with how long until", () => {
    expect(upNext(view, now).map((e) => `${e.date} ${e.time} ${e.title} (${e.inHowLong})`)).toEqual([
      "Tue Dec 1 12:55am NH159 to Tokyo (in 5 days)",
      "Wed Dec 2 3:00pm Check in: Hotel Resol Ueno (in 6 days)",
      "Wed Dec 2 6:30pm Head spa (in 6 days)",
    ]);
  });

  it("every entry names the item it opens", () => {
    const ids = new Set(view.items.map((i) => i.id));
    const entries = upNext(view, now, 10);
    expect(entries.length).toBeGreaterThan(3);
    for (const e of entries) expect(ids.has(e.itemId)).toBe(true);
    expect(entries[0].itemId).toBe(present(view.items.find((i) => i.flight?.flightNumber === "NH159")).id);
  });

  it("during the trip: what comes next from now", () => {
    const fri = DateTime.fromISO("2026-12-05T16:00", { zone: "Asia/Hong_Kong" }).toMillis();
    expect(upNext(view, fri).map((e) => `${e.time} ${e.title}`)).toEqual(["5:00pm Jantzen Tailor", "6:45pm Sun Kai Tat", "11:00am Check out: Stanford Hotel"]);
  });

  it("after the trip: nothing", () => {
    expect(upNext(view, DateTime.fromISO("2027-01-01").toMillis())).toEqual([]);
  });
});
