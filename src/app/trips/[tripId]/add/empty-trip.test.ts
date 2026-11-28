import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { TRIP_ID, USERS } from "@/fixtures/december-trip";
import { jacob, kenny, testContext } from "@/server/testing";
import { createTrip, getTripView } from "@/server/services/trip-service";
import { DayView } from "../day-view";
import type { Requester } from "@/domain/types";

async function emptyTripFor(requester: Requester) {
  const { ctx, db } = await testContext({ withItems: false });
  const view = await getTripView(ctx, TRIP_ID, requester);
  return { view, ctx, db };
}

function render(view: Awaited<ReturnType<typeof emptyTripFor>>["view"]) {
  return renderToStaticMarkup(createElement(DayView, { view, days: [], todayKey: "2026-11-27" }));
}

describe("empty trip", () => {
  it("shows editors the add action and the connect link", async () => {
    const { view } = await emptyTripFor(kenny);
    const html = render(view);
    expect(html).toContain("Start with your flights.");
    expect(html).toContain("Booked or not, add the flights first. The app works out which nights you need a bed, in local time.");
    expect(html).toContain(`href="/trips/${TRIP_ID}/add?type=flight"`);
    expect(html).toContain(">Add a flight<");
    expect(html).not.toContain("Connect Claude");
    expect(html).not.toContain("You review everything");
  });

  it("shows a new owner the same action on a trip they just made", async () => {
    const { ctx } = await emptyTripFor(jacob);
    const id = await createTrip(ctx, { id: USERS.jacob.id, name: USERS.jacob.name }, "Lisbon in March");
    const html = render(await getTripView(ctx, id, jacob));
    expect(html).toContain(`href="/trips/${id}/add?type=flight"`);
  });

  it("shows viewers a plain sentence and no button", async () => {
    const { view } = await emptyTripFor(kenny);
    const html = render({ ...view, permissions: { ...view.permissions, canEdit: false, role: "viewer" } });
    expect(html).toContain("Nothing here yet.");
    expect(html).not.toContain("/add");
    expect(html).not.toContain("Add a flight");
    expect(html).not.toContain("Connect Claude");
  });
});
