import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import NotFound, { metadata } from "./not-found";

describe("app not found page", () => {
  const html = renderToStaticMarkup(createElement(NotFound));

  it("says the page is not here, with one way out to the trip list", () => {
    expect(html).toContain("This page isn&#x27;t here.");
    expect(html.match(/<a /g)).toHaveLength(1);
    expect(html).toContain('href="/"');
    expect(html).toContain("Go to your trips");
  });

  it("does not reveal whether a trip or item exists, or what the person may do", () => {
    for (const word of ["exist", "permission", "owner", "not allowed", "access", "invite", "sign in"]) {
      expect(html.toLowerCase()).not.toContain(word);
    }
  });

  it("is kept out of search engines", () => {
    expect(metadata.robots).toEqual({ index: false, follow: false });
  });
});
