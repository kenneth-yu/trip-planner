import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { Attention } from "@/server/attention";
import { AttentionPage } from "../attention";
import { startOf } from "./check-controls";

vi.mock("./actions", () => ({
  dismissCheckAction: vi.fn(),
  restoreCheckAction: vi.fn(),
}));

const SENTENCE = "Two stays overlap Dec 10 to 13: Airbnb 528 Nathan Road and 'Stay at Total (USD) $1,183.22'. Check whether one is a duplicate.";
const TRIP = "00000000-0000-4000-8300-000000000001";

function data(canEdit: boolean): Attention {
  const finding = { key: "overlapping_stays|a@1|b@2|", kind: "overlapping_stays" as const, sentence: SENTENCE, itemIds: ["a", "b"], anchor: "0123456789abcdef" };
  return {
    deadlines: [],
    findings: [finding],
    dismissed: [{ anchor: "fedcba9876543210", sentence: "Nowhere booked for the night of Dec 8 in Shenzhen.", by: "Kenneth", mine: false, on: "Nov 27" }],
    everyFinding: [finding],
    canEdit,
    pending: 0,
    pendingFrom: [],
    beforeTrip: true,
    tripStartMs: null,
  };
}

const html = (canEdit: boolean) => renderToStaticMarkup(createElement(AttentionPage, { data: data(canEdit), tripId: TRIP }));

describe("check controls as rendered", () => {
  it("editors get This is fine on each check and Show again on each dismissed one", () => {
    const out = html(true);
    expect(out).toContain("This is fine");
    expect(out).toContain("Show again");
    expect(out).toContain('id="check-0123456789abcdef"');
  });

  it("viewers get neither control, but still see the check and the folded list", () => {
    const out = html(false);
    expect(out).not.toContain("This is fine");
    expect(out).not.toContain("Show again");
    expect(out).not.toContain("Undo");
    expect(out).toContain("Two stays overlap Dec 10 to 13");
    expect(out).toContain("Marked as fine (1)");
    expect(out).toContain("Kenneth, Nov 27");
  });

  it("the accessible name holds the first eight words and nothing after them", () => {
    const label = `This is fine: ${startOf(SENTENCE)}`;
    expect(label).toBe("This is fine: Two stays overlap Dec 10 to 13: Airbnb");
    const out = html(true);
    expect(out).toContain(`aria-label="${label}"`);
    expect(out).not.toContain("aria-label=\"This is fine: Two stays overlap Dec 10 to 13: Airbnb 528");
  });

  it("the page never prints a finding key", () => {
    expect(html(true)).not.toContain("overlapping_stays|");
  });

  it("a dismisser who has left shows the date with Marked", () => {
    const d = data(true);
    d.dismissed = [{ ...d.dismissed[0], by: null }];
    expect(renderToStaticMarkup(createElement(AttentionPage, { data: d, tripId: TRIP }))).toContain("Marked Nov 27");
  });
});
