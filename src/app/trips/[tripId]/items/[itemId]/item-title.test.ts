import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { buildFixtureTrip, USERS } from "@/fixtures/december-trip";
import { present } from "@/testing/present";
import { projectTrip, type VisibleItem } from "@/domain/visibility/project";
import type { Requester } from "@/domain/types";
import { ItemDetails } from "./item-details";
import { itemHeading } from "./item-title";

vi.mock("next/navigation", () => ({ useSearchParams: () => new URLSearchParams() }));

const kenny: Requester = { kind: "member", userId: USERS.kenny.id, homeZone: "America/New_York" };
const view = projectTrip(buildFixtureTrip(), kenny);
const flight = present(view.items.find((i) => i.type === "flight"));
const numberless: VisibleItem = { ...flight, booked: false, title: "JFK to HND", flight: { fromAirport: "JFK", toAirport: "HND", flightNumber: "" } };

describe("the name of a flight", () => {
  it("falls back to Flight when a draft has no number, never a blank in front of the city", () => {
    expect(itemHeading(numberless)).toBe("Flight to Tokyo");
  });

  it("still leads with the number when there is one", () => {
    expect(itemHeading({ ...numberless, flight: { fromAirport: "JFK", toAirport: "HND", flightNumber: "NH159" } })).toBe("NH159 to Tokyo");
  });

  it("is just Flight when the airport is unknown too", () => {
    expect(itemHeading({ ...numberless, flight: { fromAirport: "ZZZ", toAirport: "QQQ", flightNumber: "" } })).toBe("Flight");
  });

  it("is what the details page shows as its title", () => {
    const html = renderToStaticMarkup(createElement(ItemDetails, { view: { ...view, items: [numberless] }, item: numberless, nowMs: Date.parse("2026-11-27T12:00:00Z"), viewerTravelerId: null }));
    expect(html).toContain(">Flight to Tokyo<");
    expect(html).not.toContain("> to Tokyo<");
  });
});
