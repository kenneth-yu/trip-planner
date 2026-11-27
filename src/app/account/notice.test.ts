import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { TripList } from "../sign-in/trip-list";
import { noticeText, noticeValue } from "./notice";
import { OneTimeNotice } from "./one-time-notice";

vi.mock("./notice-actions", () => ({ clearOneTimeNotice: async () => undefined }));

describe("the one time status lines", () => {
  it("says which trip was deleted and that the account is deleted", () => {
    expect(noticeText(noticeValue({ kind: "trip-deleted" }))).toBe("Trip deleted.");
    expect(noticeText(noticeValue({ kind: "account-deleted" }))).toBe("Your account is deleted.");
  });

  it("shows nothing for a missing, broken or forged value", () => {
    expect(noticeText(undefined)).toBeNull();
    expect(noticeText("not json")).toBeNull();
    expect(noticeText('{"kind":"other"}')).toBeNull();
  });

  it("renders as a status region and renders nothing without a line", () => {
    expect(renderToStaticMarkup(createElement(OneTimeNotice, { text: "Trip deleted." }))).toContain('role="status"');
    expect(renderToStaticMarkup(createElement(OneTimeNotice, { text: null }))).toBe("");
  });
});

describe("the home page account link", () => {
  it("sits above Sign out and leaves Sign out working", () => {
    const html = renderToStaticMarkup(createElement(TripList, { trips: [{ id: "t1", name: "Lisbon, someday", role: "owner" as const }], signOut: async () => undefined }));
    expect(html).toContain('href="/account"');
    expect(html).toContain("Your account");
    expect(html.indexOf("Your account")).toBeLessThan(html.indexOf("Sign out"));
    expect(html).toContain("Sign out");
  });

  it("is there on an empty list too", () => {
    const html = renderToStaticMarkup(createElement(TripList, { trips: [], signOut: async () => undefined }));
    expect(html).toContain("Your account");
  });
});
