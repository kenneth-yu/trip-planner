import { describe, expect, it } from "vitest";
import { TIP_KINDS } from "@/domain/smarts/kinds";
import { FLASH_MESSAGE, FLASH_TEXT, TIP_HIDDEN_FLASH } from "./flash";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { parseFlash, StatusLine } from "./flash-status";

describe("a flash cookie left over from an older version", () => {
  it("the retired tip_hidden value is ignored without throwing", () => {
    expect(parseFlash("tip_hidden")).toBeNull();
    expect(parseFlash("")).toBeNull();
    expect(parseFlash("tip_hidden_nonsense")).toBeNull();
  });

  it("every current value is still understood", () => {
    expect(parseFlash("tip_hidden_bags")).toBe("tip_hidden_bags");
    expect(parseFlash("saved")).toBe("saved");
  });
});

describe("the status line", () => {
  it("makes Account in a tips-off message a link to the Travel smarts section", () => {
    const message = FLASH_MESSAGE.tip_hidden_bags;
    const html = renderToStaticMarkup(createElement(StatusLine, { text: message.lead, link: message.link }));
    expect(html).toContain('<a href="/account#travel-smarts">Account</a>');
    expect(html.replace(/<[^>]+>/g, "")).toBe("Bag storage tips are off. Turn them back on in Account.");
  });

  it("leaves other messages as plain text", () => {
    expect(renderToStaticMarkup(createElement(StatusLine, { text: "Saved" }))).not.toContain("<a ");
    expect(renderToStaticMarkup(createElement(StatusLine, { text: "A note that happens to end in Account." }))).not.toContain("<a ");
  });

  it("shows no link when there is no message", () => {
    expect(renderToStaticMarkup(createElement(StatusLine, { text: null, link: FLASH_MESSAGE.tip_hidden_bags.link }))).not.toContain("<a ");
  });
});

describe("the message after Hide tips like this", () => {
  it("names the kind and says how to turn it back on", () => {
    expect(FLASH_TEXT[TIP_HIDDEN_FLASH.bags]).toBe("Bag storage tips are off. Turn them back on in Account.");
    expect(FLASH_TEXT[TIP_HIDDEN_FLASH.airport]).toBe("Airport tips are off. Turn them back on in Account.");
  });

  it("has a message for every kind", () => {
    for (const kind of TIP_KINDS) expect(FLASH_TEXT[TIP_HIDDEN_FLASH[kind]]).toContain("tips are off");
  });
});
