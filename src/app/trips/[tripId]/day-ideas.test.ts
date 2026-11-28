import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { TRIP_ID } from "@/fixtures/december-trip";
import { DayIdeas } from "./day-ideas";

const line = { city: "Shenzhen", line: "2 ideas for Shenzhen", ideas: [{ id: "a", title: "Buy gold", second: null }, { id: "b", title: "Massage", second: "Tianyuan Foot Spa" }] };
const html = (lines: (typeof line)[]) => renderToStaticMarkup(createElement(DayIdeas, { tripId: TRIP_ID, lines }));

describe("the line about ideas at the end of a day", () => {
  it("is one closed button, 44px, saying how many, and shows no idea until it is opened", () => {
    const out = html([line]);
    expect(out).toContain("2 ideas for Shenzhen</button>");
    expect(out).toContain('aria-expanded="false"');
    expect(out).not.toContain("Buy gold");
  });

  it("is nothing at all when the city has no open ideas", () => {
    expect(html([])).toBe("");
  });

  it("is one line for each city on a travel day", () => {
    const out = html([line, { ...line, city: "Hong Kong", line: "1 idea for Hong Kong" }]);
    expect(out).toContain("2 ideas for Shenzhen");
    expect(out).toContain("1 idea for Hong Kong");
  });
});
