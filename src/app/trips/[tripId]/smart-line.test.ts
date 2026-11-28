import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { SmartLine } from "./smart-line";

const render = (props: Partial<Parameters<typeof SmartLine>[0]> = {}) =>
  renderToStaticMarkup(createElement(SmartLine, { kind: "check", line: "Tight: 55 min to change planes at HKG.", why: "You land at Hong Kong at 1:25pm.", ...props }));

describe("the short line with Why?", () => {
  it("shows one line and a closed Why? button, with the explanation not visible", () => {
    const html = render();
    expect(html).toContain("Tight: 55 min to change planes at HKG.");
    expect(html).toContain('aria-expanded="false"');
    expect(html).toMatch(/<div id="[^"]+" hidden="" class="[^"]*">/);
  });

  it("names the button after the line, so each Why? is different to a screen reader", () => {
    expect(render()).toContain('aria-label="Why? Tight: 55 min to change planes at HKG."');
  });

  it("ties the button to the panel it opens", () => {
    const html = render();
    const controls = /aria-controls="([^"]+)"/.exec(html)?.[1];
    expect(controls).toBeTruthy();
    expect(html).toContain(`id="${controls}"`);
  });

  it("opens in place with the explanation, an Also line and the actions", () => {
    const html = render({ defaultOpen: true, also: ["Separate bookings, 2 h 10 min apart."], children: createElement("button", { type: "button" }, "This is fine") });
    expect(html).toContain('aria-expanded="true"');
    expect(html).not.toMatch(/hidden=""/);
    expect(html).toContain("You land at Hong Kong at 1:25pm.");
    expect(html).toContain("Also: Separate bookings, 2 h 10 min apart.");
    expect(html).toContain("This is fine");
  });

  it("has no Also line when nothing else applies", () => {
    expect(render({ defaultOpen: true })).not.toContain("Also:");
  });

  it("marks checks and tips differently, and uses a plain 44px button class", () => {
    expect(render({ kind: "check" })).toContain('data-kind="check"');
    expect(render({ kind: "tip" })).toContain('data-kind="tip"');
    expect(render()).toContain("quiet");
  });
});
