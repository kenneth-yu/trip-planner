import { describe, expect, it } from "vitest";
import { buildFixtureTrip, TRIP_ID, USERS } from "@/fixtures/december-trip";
import { present } from "@/testing/present";
import { buildDays } from "../time/days";
import { DateTime } from "../time/luxon";
import type { Requester } from "../types";
import { projectTrip } from "../visibility/project";
import { ANYWHERE, canSeeIdea, freeTime, groupIdeas, ideaCity, ideasForDay, otherCity, sleepCity, type Idea } from "./ideas";

const NY = "America/New_York";
const kenny: Requester = { kind: "member", userId: USERS.kenny.id, homeZone: NY };
const jacob: Requester = { kind: "member", userId: USERS.jacob.id, homeZone: NY };
const viewer: Requester = { kind: "member", userId: "user-mom", homeZone: NY };
const link: Requester = { kind: "link", homeZone: NY };

const idea = (title: string, overrides: Partial<Idea> = {}): Idea => ({
  id: `idea-${title}`,
  tripId: TRIP_ID,
  title,
  location: null,
  city: null,
  note: "",
  visibility: "everyone",
  visibleToUserIds: [],
  state: "open",
  createdBy: USERS.kenny.id,
  doneBy: null,
  doneAt: null,
  createdAt: "2026-11-28T00:00:00.000Z",
  updatedAt: "2026-11-28T00:00:00.000Z",
  ...overrides,
});

const view = projectTrip(buildFixtureTrip(), kenny);
const days = buildDays(view);
const day = (key: string) => present(days.find((d) => d.key === key), key);

describe("who can see an idea", () => {
  it("shows an everyone idea to every member and to no link visitor", () => {
    for (const who of [kenny, jacob, viewer]) expect(canSeeIdea(idea("Buy gold"), who)).toBe(true);
    expect(canSeeIdea(idea("Buy gold"), link)).toBe(false);
  });

  it("shows an only me idea to its creator alone", () => {
    const mine = idea("Surprise", { visibility: "only_me", createdBy: USERS.jacob.id });
    expect(canSeeIdea(mine, jacob)).toBe(true);
    expect(canSeeIdea(mine, kenny)).toBe(false);
    expect(canSeeIdea(mine, viewer)).toBe(false);
    expect(canSeeIdea(mine, link)).toBe(false);
  });

  it("shows a specific idea to its creator and the people on the list", () => {
    const some = idea("Dinner", { visibility: "specific", visibleToUserIds: [USERS.jacob.id], createdBy: USERS.kenny.id });
    expect(canSeeIdea(some, kenny)).toBe(true);
    expect(canSeeIdea(some, jacob)).toBe(true);
    expect(canSeeIdea(some, viewer)).toBe(false);
  });

  it("shows an only me idea with no creator to nobody, and a specific idea with no creator and an empty list to nobody", () => {
    for (const who of [kenny, jacob, viewer, link]) {
      expect(canSeeIdea(idea("Orphan", { visibility: "only_me", createdBy: null }), who)).toBe(false);
      expect(canSeeIdea(idea("Orphan", { visibility: "specific", visibleToUserIds: [], createdBy: null }), who)).toBe(false);
    }
  });

  it("still shows an everyone idea with no creator, because it was for everyone", () => {
    expect(canSeeIdea(idea("Shared", { createdBy: null }), jacob)).toBe(true);
  });
});

describe("which city an idea belongs to", () => {
  it("is the city it names, the city of its place, or the city a plain address resolves to, else none", () => {
    expect(ideaCity(idea("Buy gold", { city: "Shenzhen" }))).toBe("Shenzhen");
    expect(ideaCity(idea("Massage", { location: { name: "Tianyuan Foot Spa", city: "Shenzhen" } }))).toBe("Shenzhen");
    expect(ideaCity(idea("Ramen", { location: { name: "Ichiran", address: "Shibuya, Tokyo" } }))).toBe("Tokyo");
    expect(ideaCity(idea("Something"))).toBeNull();
  });
});

describe("the days an idea shows on", () => {
  it("shows as one line on each Shenzhen day, and on no Hong Kong or Tokyo day", () => {
    const gold = [idea("Buy gold", { city: "Shenzhen" })];
    for (const key of ["2026-12-07", "2026-12-08", "2026-12-09"]) expect(ideasForDay(day(key), gold).map((d) => d.line)).toEqual(["1 idea for Shenzhen"]);
    for (const key of ["2026-12-03", "2026-12-12", "2026-12-14"]) expect(ideasForDay(day(key), gold)).toEqual([]);
  });

  it("counts every open idea for the city, and leaves out done and dropped ones", () => {
    const list = [idea("Buy gold", { city: "Shenzhen" }), idea("Massage", { location: { name: "Tianyuan Foot Spa", city: "Shenzhen" } }), idea("Done", { city: "Shenzhen", state: "done" }), idea("Dropped", { city: "Shenzhen", state: "dropped" })];
    expect(ideasForDay(day("2026-12-08"), list).map((d) => d.line)).toEqual(["2 ideas for Shenzhen"]);
  });

  it("names the city you sleep in on a travel day, then the other city on its own line when it has ideas", () => {
    const travel = days.find((d) => d.place?.includes(" to "));
    const found = present(travel, "a travel day");
    const both = [idea("A", { city: sleepCity(found) ?? "" }), idea("B", { city: otherCity(found) ?? "" })];
    expect(ideasForDay(found, both).map((d) => d.city)).toEqual([sleepCity(found), otherCity(found)]);
    expect(ideasForDay(found, [idea("B", { city: otherCity(found) ?? "" })]).map((d) => d.city)).toEqual([otherCity(found)]);
  });
});

describe("the Ideas page groups", () => {
  it("come in trip order with the city's dates, then cities off the route, then Anywhere", () => {
    const groups = groupIdeas(view, days, [idea("Macau casino", { city: "Macau" }), idea("Anything"), idea("Ramen", { city: "Tokyo" }), idea("Gold", { city: "Shenzhen" })]);
    expect(groups.map((g) => g.title)).toEqual(["Tokyo, Dec 1 to 15", "Shenzhen, Dec 6 to 10", "Macau", ANYWHERE]);
    expect(groups.at(-1)?.city).toBeNull();
  });

  it("has no group for a city with no ideas, and none at all without ideas", () => {
    expect(groupIdeas(view, days, [])).toEqual([]);
    expect(groupIdeas(view, days, [idea("Gold", { city: "Shenzhen" })]).map((g) => g.title)).toEqual(["Shenzhen, Dec 6 to 10"]);
  });
});

describe("free time on a city's days", () => {
  it("offers whole free days first as all day, on that city's days only, earliest first, at most four", () => {
    const found = freeTime(view, days, "Shenzhen");
    expect(found.length).toBeLessThanOrEqual(4);
    expect(found.length).toBeGreaterThan(0);
    expect(found.every((f) => f.dayKey >= "2026-12-06" && f.dayKey <= "2026-12-10")).toBe(true);
    expect([...found].sort((a, b) => a.startLocal.localeCompare(b.startLocal))).toEqual(found);
    expect(found.find((f) => f.dayKey === "2026-12-08")).toMatchObject({ startLocal: "2026-12-08T09:00", endLocal: null, label: "Tue Dec 8, all day" });
  });

  it("never offers a time inside a plan, a flight or a busy block, and needs two hours", () => {
    const agg = buildFixtureTrip();
    const base = present(agg.items.find((i) => i.type === "plan"));
    agg.items.push({
      ...base,
      id: "shenzhen-plan",
      title: "Factory visit",
      start: { at: DateTime.fromISO("2026-12-08T11:00", { zone: "Asia/Shanghai" }).toUTC().toISO(), zone: "Asia/Shanghai" },
      end: { at: DateTime.fromISO("2026-12-08T17:30", { zone: "Asia/Shanghai" }).toUTC().toISO(), zone: "Asia/Shanghai" },
      location: { name: "Factory", city: "Shenzhen" },
      deadlines: [],
    });
    const busyView = projectTrip(agg, kenny);
    const found = freeTime(busyView, buildDays(busyView), "Shenzhen").filter((f) => f.dayKey === "2026-12-08");
    expect(found.map((f) => [f.startLocal, f.endLocal])).toEqual([
      ["2026-12-08T09:00", "2026-12-08T11:00"],
      ["2026-12-08T17:30", "2026-12-08T21:00"],
    ]);
    expect(found.map((f) => f.label)).toEqual(["Tue Dec 8, 9:00am to 11:00am", "Tue Dec 8, 5:30pm to 9:00pm"]);
  });

  it("offers nothing for a city that is not on the trip's days", () => {
    expect(freeTime(view, days, "Macau")).toEqual([]);
  });
});
