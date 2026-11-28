import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { TravelTipsSection } from "./travel-tips-section";

vi.mock("./travel-tips-actions", () => ({ saveTravelTipsAction: async () => ({ status: "idle" }) }));

const render = (tipsOn: boolean, kindsOff: Parameters<typeof TravelTipsSection>[0]["kindsOff"]) => renderToStaticMarkup(createElement(TravelTipsSection, { tipsOn, kindsOff }));

describe("the Travel tips section of the account page", () => {
  it("is reachable at #travel-smarts and has the switch, five kinds and the note about warnings", () => {
    const html = render(true, []);
    expect(html).toContain('id="travel-smarts"');
    expect(html).toContain("Show travel tips");
    expect(html.match(/name="kind"/g)).toHaveLength(5);
    expect(html).toContain("always show");
  });

  it("reflects what is saved", () => {
    const html = render(false, ["bags"]);
    expect(html).not.toMatch(/name="tipsOn"[^>]*checked/);
    expect(html).toMatch(/checked="" value="airport"/);
    expect(html).not.toMatch(/checked="" value="bags"/);
  });

  it("has a status region that is empty until saved", () => {
    expect(render(true, [])).toContain('<p role="status"></p>');
  });
});
