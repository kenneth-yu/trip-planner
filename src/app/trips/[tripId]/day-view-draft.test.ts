import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { buildFixtureTrip, USERS } from "@/fixtures/december-trip";
import { buildDays } from "@/domain/time/days";
import { projectTrip, type TripView } from "@/domain/visibility/project";
import type { Item, Requester } from "@/domain/types";
import { present } from "@/testing/present";
import { DayView } from "./day-view";

vi.mock("next/navigation", () => ({ useSearchParams: () => new URLSearchParams() }));

const kenny: Requester = { kind: "member", userId: USERS.kenny.id, homeZone: "America/New_York" };

function render(change: (item: Item) => Item, pick: (item: Item) => boolean): { html: string; item: Item } {
  const agg = buildFixtureTrip();
  const target = present(agg.items.find(pick));
  const view: TripView = projectTrip({ ...agg, items: agg.items.map((i) => (i.id === target.id ? change(i) : i)) }, kenny);
  return { html: renderToStaticMarkup(createElement(DayView, { view, days: buildDays(view), todayKey: "2026-11-27" })), item: target };
}

const count = (html: string) => html.split("Not booked yet").length - 1;

describe("a draft in the day view", () => {
  it("says Not booked yet after the place line of a plan, in plain text", () => {
    const { html } = render((i) => ({ ...i, booked: false }), (i) => i.type === "plan" && i.status === "confirmed");
    expect(count(html)).toBe(1);
    expect(html).toMatch(/<span class="[^"]+">Not booked yet<\/span>/);
  });

  it("says it once on a stay, at check in and not again at check out", () => {
    const { html } = render((i) => ({ ...i, booked: false }), (i) => i.type === "stay" && i.status === "confirmed");
    expect(count(html)).toBe(1);
  });

  it("leaves the flight's own header to say it, with no second line", () => {
    const { html } = render((i) => ({ ...i, booked: false }), (i) => i.type === "flight");
    expect(html).toMatch(/not booked yet/i);
    expect(count(html)).toBe(0);
  });

  it("says nothing on a trip where everything is booked", () => {
    const agg = buildFixtureTrip();
    const view = projectTrip(agg, kenny);
    expect(renderToStaticMarkup(createElement(DayView, { view, days: buildDays(view), todayKey: "2026-11-27" }))).not.toMatch(/not booked yet/i);
  });
});
