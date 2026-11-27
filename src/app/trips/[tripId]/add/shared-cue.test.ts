import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { TRIP_ID, USERS } from "@/fixtures/december-trip";
import { buildDays } from "@/domain/time/days";
import { kenny, testContext } from "@/server/testing";
import { getTripView, quickAddItem } from "@/server/services/trip-service";
import { DayView } from "../day-view";

vi.mock("next/navigation", () => ({ useSearchParams: () => new URLSearchParams() }));

async function renderDay(visibility: "everyone" | "only_me" | "specific") {
  const { ctx } = await testContext({ withItems: false });
  await quickAddItem(
    ctx,
    TRIP_ID,
    kenny,
    { type: "plan", title: "Pick up the ring", city: "Hong Kong", startLocal: "2026-12-05T17:00", endLocal: "2026-12-05T18:00" },
    { visibility, visibleToUserIds: visibility === "specific" ? [USERS.jacob.id] : [] },
  );
  const view = await getTripView(ctx, TRIP_ID, kenny);
  return renderToStaticMarkup(createElement(DayView, { view, days: buildDays(view), todayKey: "2026-12-05" }));
}

describe("rows that not everyone can see", () => {
  it("says Only you on an only me plan", async () => {
    expect(await renderDay("only_me")).toContain("Only you");
  });

  it("says a picked people plan is not shared with everyone", async () => {
    expect(await renderDay("specific")).toContain("Not shared with everyone");
  });

  it("says nothing on a plan everyone sees", async () => {
    const html = await renderDay("everyone");
    expect(html).not.toContain("Only you");
    expect(html).not.toContain("Not shared");
  });
});
