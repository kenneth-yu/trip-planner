import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { TravelTipsSection } from "./travel-tips-section";

vi.mock("./travel-tips-actions", () => ({ saveTravelTipsAction: async () => ({ status: "idle" }) }));

const render = (tipsOn: boolean, kindsOff: Parameters<typeof TravelTipsSection>[0]["kindsOff"]) => renderToStaticMarkup(createElement(TravelTipsSection, { tipsOn, kindsOff }));

describe("the Travel tips section of the account page", () => {
  it("is reachable at #travel-smarts and has the switch, the kinds that have tips and the note about warnings", () => {
    const html = render(true, []);
    expect(html).toContain('id="travel-smarts"');
    expect(html).toContain("Travel smarts");
    expect(html).toContain("> Travel tips</label>");
    expect(html).toContain('role="switch"');
    expect(html.match(/name="kind"/g)).toHaveLength(3);
    expect(html).toContain("Sleep on long flights");
    expect(html).toContain("Storing bags around check-in and check-out");
    expect(html).toContain("always show");
    expect(html).toContain("choose This is fine on it");
    expect(html).not.toContain("Border crossings");
    expect(html).not.toContain("Plans right after a long flight");
  });

  it("reflects what is saved", () => {
    const html = render(false, ["bags"]);
    expect(html).not.toMatch(/name="tipsOn"[^>]*checked/);
    expect(html).toMatch(/checked="" value="airport"/);
    expect(html).not.toMatch(/checked="" value="bags"/);
  });

  it("says On or Off next to the switch", () => {
    expect(render(true, [])).toContain('<span aria-hidden="true">On</span>');
    expect(render(false, [])).toContain('<span aria-hidden="true">Off</span>');
  });

  it("shows the kinds while the switch is on and keeps them in the form, hidden, while it is off", () => {
    expect(render(true, [])).toMatch(/<fieldset>/);
    const off = render(false, ["bags"]);
    expect(off).toMatch(/<fieldset hidden="">/);
    expect(off.match(/name="kind"/g)).toHaveLength(3);
  });

  it("has a status region that is empty until saved", () => {
    expect(render(true, [])).toContain('<p role="status"></p>');
  });
});
