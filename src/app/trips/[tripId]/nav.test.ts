import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { TRIP_ID } from "@/fixtures/december-trip";
import { TripNav } from "./nav";

vi.mock("next/navigation", () => ({ usePathname: () => `/trips/${TRIP_ID}/add` }));

describe("trip nav", () => {
  it("gives editors an Add link on every trip screen", () => {
    const html = renderToStaticMarkup(createElement(TripNav, { tripId: TRIP_ID, canEdit: true }));
    expect(html).toContain(`<a aria-current="page" href="/trips/${TRIP_ID}/add">Add</a>`);
  });

  it("gives viewers no Add link", () => {
    const html = renderToStaticMarkup(createElement(TripNav, { tripId: TRIP_ID, canEdit: false }));
    expect(html).not.toContain(`/trips/${TRIP_ID}/add`);
  });
});
