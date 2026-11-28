import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { arrangeRows, rowKey } from "@/domain/smarts/rows";
import { SmartRow, TipsIntro } from "./smart-row";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: () => undefined }) }));

const rows = arrangeRows([
  { source: "check", anchor: "a".repeat(16), itemId: "p1", row: "event", line: "Dinner at 6:30am? Did you mean 6:30pm?", why: "Why", fix: { label: "Change to 6:30pm", done: "Changed." } },
  { source: "tip", anchor: "b".repeat(16), itemId: "f1", row: "flight", line: "Leave the hotel by noon.", why: "Why", tipKind: "airport" },
]);

const render = (id: string, row: "event" | "flight", canEdit: boolean) => renderToStaticMarkup(createElement(SmartRow, { tripId: "t", row: rows.get(rowKey(id, row)), canEdit }));

describe("who sees the buttons under a line", () => {
  it("an editor sees the fix and This is fine on a check, and Hide tips like this on a tip", () => {
    const check = render("p1", "event", true);
    expect(check).toContain("Change to 6:30pm");
    expect(check).toContain("This is fine");
    expect(render("f1", "flight", true)).toContain("Hide tips like this");
  });

  it("a viewer sees the line and Why? but no buttons", () => {
    const check = render("p1", "event", false);
    expect(check).toContain("Dinner at 6:30am? Did you mean 6:30pm?");
    expect(check).toContain("Why?");
    expect(check).not.toContain("Change to");
    expect(check).not.toContain("This is fine");
    expect(render("f1", "flight", false)).not.toContain("Hide tips like this");
  });
});

describe("the first tip sentence", () => {
  it("links Turn off tips to the account section and has no button to dismiss it", () => {
    const html = renderToStaticMarkup(createElement(TipsIntro));
    expect(html).toContain('href="/account#travel-smarts"');
    expect(html).toContain("Turn off tips");
    expect(html).toContain("Tips like this are optional.");
    expect(html).not.toContain("<button");
  });
});
