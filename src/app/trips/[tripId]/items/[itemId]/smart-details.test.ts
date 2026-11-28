import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { present } from "@/testing/present";
import { buildDemoTrip, PACKED_TRIP } from "@/fixtures/demo-trips";
import { USERS } from "@/fixtures/december-trip";
import { arrangeRows, checkSources, tipSources } from "@/domain/smarts/rows";
import { smartTips } from "@/domain/smarts/tips";
import { runChecks } from "@/domain/checks/checks";
import { fromLocal } from "@/domain/time/format";
import { projectTrip } from "@/domain/visibility/project";
import type { Item, Requester } from "@/domain/types";
import { DayView } from "../../day-view";
import { buildDays } from "@/domain/time/days";
import { ItemDetails } from "./item-details";
import { itemOf } from "./item-of";

vi.mock("next/navigation", () => ({ useSearchParams: () => new URLSearchParams(), useRouter: () => ({ refresh: () => undefined }) }));

const owner: Requester = { kind: "member", userId: USERS.kenny.id, homeZone: "America/New_York" };

function slippedView() {
  const packed = buildDemoTrip(PACKED_TRIP);
  const dinner = present(packed.items.find((i) => i.title === "Dinner at Gonpachi"));
  const length = Date.parse(dinner.end.at) - Date.parse(dinner.start.at);
  const start = fromLocal("2027-03-09T06:30", "Asia/Tokyo");
  const moved: Item = { ...dinner, start, end: { at: new Date(Date.parse(start.at) + length).toISOString(), zone: "Asia/Tokyo" } };
  const view = projectTrip({ ...packed, items: packed.items.map((i) => (i.id === moved.id ? moved : i)) }, owner);
  const findings = runChecks(view).map((f) => ({ ...f, anchor: "a".repeat(16) }));
  return { view, moved, smart: { rows: arrangeRows([...checkSources(findings), ...tipSources(smartTips(view).map((t) => ({ ...t, anchor: "b".repeat(16) })))]), showIntro: false } };
}

describe("smart lines on the item page and the day list", () => {
  it("show the wrong time line, Why? and both actions under the plan on its page", () => {
    const { view, moved, smart } = slippedView();
    const html = renderToStaticMarkup(createElement(ItemDetails, { view, item: present(itemOf(view, moved.id)), nowMs: Date.parse("2027-03-01T12:00:00Z"), viewerTravelerId: null, smart }));
    expect(html).toContain("Dinner at 6:30am? Did you mean 6:30pm?");
    expect(html).toContain("Change to 6:30pm");
    expect(html).toContain("This is fine");
    expect(html).toContain("Why?");
  });

  it("show the same line under the plan in the day list, and the intro once when asked", () => {
    const { view, smart } = slippedView();
    const days = buildDays(view);
    const html = renderToStaticMarkup(createElement(DayView, { view, days, todayKey: "2027-03-01", anchors: false, smart: { ...smart, showIntro: true } }));
    expect(html).toContain("Dinner at 6:30am? Did you mean 6:30pm?");
    expect(html.match(/Tips like this are optional./g)).toHaveLength(1);
  });

  it("show nothing extra without smart lines", () => {
    const { view } = slippedView();
    const html = renderToStaticMarkup(createElement(DayView, { view, days: buildDays(view), todayKey: "2027-03-01", anchors: false }));
    expect(html).not.toContain("Why?");
  });
});
