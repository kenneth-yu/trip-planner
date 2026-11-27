import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { TRIP_ID } from "@/fixtures/december-trip";
import { TripNav } from "./nav";

const nav = vi.hoisted(() => ({ path: "" }));

vi.mock("next/navigation", () => ({ usePathname: () => nav.path }));

describe("trip nav", () => {
  beforeEach(() => {
    nav.path = `/trips/${TRIP_ID}/add`;
  });

  it("gives editors an Add link on every trip screen", () => {
    const html = renderToStaticMarkup(createElement(TripNav, { tripId: TRIP_ID, canEdit: true, canManageSharing: false }));
    expect(html).toContain(`<a aria-current="page" href="/trips/${TRIP_ID}/add">Add</a>`);
  });

  it("gives viewers no Add link", () => {
    const html = renderToStaticMarkup(createElement(TripNav, { tripId: TRIP_ID, canEdit: false, canManageSharing: false }));
    expect(html).not.toContain(`/trips/${TRIP_ID}/add`);
  });

  it("gives only the owner a Share link, last", () => {
    const owner = renderToStaticMarkup(createElement(TripNav, { tripId: TRIP_ID, canEdit: true, canManageSharing: true }));
    expect(owner.trimEnd()).toMatch(new RegExp(`<a href="/trips/${TRIP_ID}/share">Share</a></nav>$`));
    const editor = renderToStaticMarkup(createElement(TripNav, { tripId: TRIP_ID, canEdit: true, canManageSharing: false }));
    expect(editor).not.toContain("/share");
  });

  it("names the day by day screen Trip and marks it current on the trip page", () => {
    nav.path = `/trips/${TRIP_ID}`;
    const html = renderToStaticMarkup(createElement(TripNav, { tripId: TRIP_ID, canEdit: false, canManageSharing: false }));
    expect(html).toContain(`<a aria-current="page" href="/trips/${TRIP_ID}">Trip</a>`);
    expect(html).not.toContain("Day by day");
  });
});
