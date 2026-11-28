import { describe, expect, it } from "vitest";
import { buildFixtureTrip, byFlight, fixtureItem } from "@/fixtures/december-trip";
import { fromLocal } from "../time/format";
import type { Item, Requester } from "../types";
import { projectTrip } from "../visibility/project";
import { visitorStatus } from "./visitor-status";

const link = (zone: string): Requester => ({ kind: "link", homeZone: zone });
const at = (iso: string) => Date.parse(iso);

function view(zone = "America/New_York", extra: Item[] = []) {
  const agg = buildFixtureTrip();
  agg.items.push(...extra);
  return projectTrip(agg, link(zone));
}

describe("visitor status line", () => {
  it("counts days to the first departure in the visitor's own days", () => {
    expect(visitorStatus(view(), at("2026-11-27T12:00:00Z"), true)).toBe("They leave in 4 days.");
    expect(visitorStatus(view(), at("2026-11-30T12:00:00Z"), true)).toBe("They leave in 1 day.");
    expect(visitorStatus(view(), at("2026-12-01T05:30:00Z"), true)).toBe("They leave today.");
  });

  it("says where they are in the air, when they land there and what time that is for the visitor", () => {
    expect(visitorStatus(view(), at("2026-12-01T10:00:00Z"), true)).toBe("In the air to Tokyo. Lands 5:25am Tokyo time (3:25pm Tue your time).");
  });

  it("leaves out the visitor's time when the zone is not known", () => {
    expect(visitorStatus(view("UTC"), at("2026-12-01T10:00:00Z"), false)).toBe("In the air to Tokyo. Lands 5:25am Tokyo time.");
  });

  it("says where they are on the ground with the clock there", () => {
    expect(visitorStatus(view(), at("2026-12-03T12:00:00Z"), true)).toBe("In Tokyo. It is 9:00pm there.");
  });

  it("says where they are on a layover between flights, with the clock there", () => {
    expect(visitorStatus(view(), at("2026-12-05T07:00:00Z"), true)).toBe("In Hong Kong. It is 3:00pm there.");
  });

  it("follows the clock change when a stay's city goes through daylight saving", () => {
    const agg = buildFixtureTrip();
    agg.items = [
      {
        ...fixtureItem(buildFixtureTrip(), (i) => i.type === "stay"),
        id: "item-london",
        title: "Stay in London",
        start: fromLocal("2027-03-26T15:00", "Europe/London"),
        end: fromLocal("2027-03-30T11:00", "Europe/London"),
        location: { name: "Stay in London", city: "London" },
        private: [],
        deadlines: [],
      },
    ];
    const london = projectTrip(agg, link("America/New_York"));
    expect(visitorStatus(london, at("2027-03-28T00:30:00Z"), true)).toBe("In London. It is 12:30am there.");
    expect(visitorStatus(london, at("2027-03-28T01:30:00Z"), true)).toBe("In London. It is 2:30am there.");
  });

  it("says when they were back after the last item", () => {
    expect(visitorStatus(view(), at("2026-12-20T12:00:00Z"), true)).toBe("They were back on Dec 15.");
  });

  it("says nothing for a trip with nothing planned", () => {
    const agg = buildFixtureTrip();
    agg.items = [];
    expect(visitorStatus(projectTrip(agg, link("UTC")), at("2026-12-03T12:00:00Z"), false)).toBeNull();
  });

  it("is not moved by a hidden flight", () => {
    const agg = buildFixtureTrip();
    const base = fixtureItem(agg, byFlight("NH159"));
    agg.items.push({
      ...base,
      id: "item-secret-flight",
      start: fromLocal("2026-11-28T09:00", "America/New_York"),
      end: fromLocal("2026-11-28T20:00", "Europe/Lisbon"),
      visibility: "only_me",
      createdBy: "someone-else",
      private: [],
      deadlines: [],
    });
    const hidden = projectTrip(agg, link("America/New_York"));
    expect(visitorStatus(hidden, at("2026-11-27T12:00:00Z"), true)).toBe("They leave in 4 days.");
    expect(visitorStatus(hidden, at("2026-11-28T15:00:00Z"), true)).toBe("They leave in 3 days.");
  });
});
