import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { buildDemoTrip, type DemoTripSpec } from "@/fixtures/demo-trips";
import { buildFixtureTrip, USERS } from "@/fixtures/december-trip";
import { buildTripGrid } from "@/domain/timeline/trip-grid";
import { sleepPlan } from "@/domain/timeline/sleep-plan";
import { projectTrip } from "@/domain/visibility/project";
import type { Requester } from "@/domain/types";
import { WhereSleep } from "./where-sleep";

const kenny: Requester = { kind: "member", userId: USERS.kenny.id, homeZone: "America/New_York" };
const TRIP = "00000000-0000-4000-8300-000000000109";

const flights = [
  { input: { type: "flight" as const, flightNumber: "CX845", fromAirport: "JFK", toAirport: "HKG", departLocal: "2027-01-15T09:00", arriveLocal: "2027-01-16T14:00" } },
  { input: { type: "flight" as const, flightNumber: "CX846", fromAirport: "HKG", toAirport: "JFK", departLocal: "2027-01-27T16:00", arriveLocal: "2027-01-27T18:30" } },
];

function view(items: DemoTripSpec["items"]) {
  const agg = buildDemoTrip({ index: 9, name: "Hong Kong in January", travelers: ["Kenneth Yu"], members: [{ user: "kenny", role: "owner" }], items });
  const projected = projectTrip(agg, kenny);
  return { ...projected, items: projected.items.map((i) => (i.type === "flight" ? { ...i, endIsEstimated: true } : i)) };
}

const render = (canEdit: boolean, folded: boolean, items: DemoTripSpec["items"] = flights) => renderToStaticMarkup(createElement(WhereSleep, { plan: sleepPlan(view(items)), tripId: TRIP, canEdit, folded }));

describe("the section as an editor sees it on a phone", () => {
  const html = render(true, true);

  it("leads with the count, the dates and one hint, all in the owner's words", () => {
    expect(html).toContain("You need a place to stay: 11 nights");
    expect(html).toContain("Check in Sat Jan 16 · Check out Wed Jan 27");
    expect(html).toContain("Not Fri Jan 15: you&#x27;re on the plane.");
  });

  it("keeps the full sentence behind a Why? button that starts closed", () => {
    expect(html).toMatch(/<button[^>]*aria-expanded="false"[^>]*>Why\?<\/button>/);
    expect(html).toMatch(/<p id="[^"]+" class="[^"]+" hidden="">You leave New York Fri Jan 15 at 9:00am and land in Hong Kong Sat Jan 16 at about 2:00pm Hong Kong time/);
  });

  it("has one filled action that opens Add with the stay, city and both dates", () => {
    const links = [...html.matchAll(/<a [^>]*href="([^"]*\/add\?[^"]*)"[^>]*>Add a stay for these nights<\/a>/g)];
    expect(links).toHaveLength(1);
    const query = new URL(links[0][1].replace(/&amp;/g, "&"), "https://trips.test").searchParams;
    expect(Object.fromEntries(query)).toEqual({ type: "stay", city: "Hong Kong", checkIn: "2027-01-16", checkOut: "2027-01-27", booked: "no" });
  });

  it("folds Night by night, and puts the return day note there only", () => {
    expect(html).toContain("<details");
    expect(html).toContain("<summary");
    expect(html).toContain("Night by night");
    expect(html).toContain("Hong Kong, 11 nights");
    expect(html.match(/Coming home, you land in New York/g)).toHaveLength(1);
    const summaryPart = html.slice(0, html.indexOf("<details"));
    expect(summaryPart).not.toContain("Coming home");
  });

  it("is not in the warning colour; only the per night warning is", () => {
    expect(html).not.toContain("hidden=\"\">Check-out");
    expect(html).toContain("Check-out is usually 11:00am");
  });
});

describe("the section for someone who cannot edit, and on a desktop", () => {
  it("has no add action for a viewer, but the same words", () => {
    const html = render(false, false);
    expect(html).not.toContain("Add a stay");
    expect(html).toContain("You need a place to stay: 11 nights");
  });

  it("shows Night by night open, as a heading and not a disclosure", () => {
    const html = render(true, false);
    expect(html).not.toContain("<details");
    expect(html).toContain("<h3");
  });
});

describe("when nothing is open", () => {
  it("draws nothing for a trip whose nights are all covered", () => {
    const covered = [
      ...flights,
      { input: { type: "stay" as const, name: "Harbour Hotel", city: "Hong Kong", checkInDate: "2027-01-16", checkOutDate: "2027-01-27" } },
    ];
    expect(render(true, false, covered)).toBe("");
  });

  it("draws nothing for the December fixture when its own check finds no open nights", () => {
    const plan = sleepPlan(projectTrip(buildFixtureTrip(), kenny));
    const html = renderToStaticMarkup(createElement(WhereSleep, { plan, tripId: TRIP, canEdit: true, folded: false }));
    expect(html === "").toBe(plan.summary === null);
  });
});

describe("the grid", () => {
  const grid = buildTripGrid(view(flights), Date.parse("2027-01-01T00:00:00Z"));

  it("marks the plane night and every night that needs a bed", () => {
    expect(grid).not.toBeNull();
    const marks = grid?.nights ?? [];
    const keys = grid?.days.map((d) => d.key) ?? [];
    expect(marks[keys.indexOf("2027-01-15")]).toBe("plane");
    expect(marks.filter((m) => m === "bed")).toHaveLength(11);
    expect(marks[keys.indexOf("2027-01-27")]).toBeNull();
  });
});
