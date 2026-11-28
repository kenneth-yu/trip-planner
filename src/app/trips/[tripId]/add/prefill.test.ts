import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { ItemForm, type ItemFormProps } from "@/app/ui/item-form/item-form";
import { prefillFromQuery } from "./prefill";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: () => undefined, refresh: () => undefined }) }));

const stay = { type: "stay", city: "Hong Kong", checkIn: "2027-01-16", checkOut: "2027-01-27", booked: "no" };

describe("what the Add page takes from the link", () => {
  it("a stay for these nights keeps the city and both dates, and ignores booked until drafts exist", () => {
    expect(prefillFromQuery(stay)).toEqual({
      type: "stay",
      fields: { place: "Hong Kong", checkInDate: "2027-01-16", checkOutDate: "2027-01-27" },
      seats: [],
      visibility: "everyone",
      visibleToUserIds: [],
      showAsBusy: false,
    });
  });

  it("add a flight selects Flight and fills nothing else", () => {
    expect(prefillFromQuery({ type: "flight" })).toMatchObject({ type: "flight", fields: {} });
  });

  it("no query means no prefill", () => {
    expect(prefillFromQuery({})).toBeUndefined();
  });

  it("drops anything that is not a real value instead of putting it in the form", () => {
    expect(prefillFromQuery({ type: "stay", city: "", checkIn: "2027-02-30", checkOut: "soon" })?.fields).toEqual({});
    expect(prefillFromQuery({ type: "hotel", city: "Hong Kong" })).toBeUndefined();
    expect(prefillFromQuery({ type: "stay", city: "x".repeat(121) })?.fields).toEqual({});
    expect(prefillFromQuery({ type: ["stay", "plan"], city: ["a", "b"] })).toBeUndefined();
  });

  it("only a stay takes the city and dates", () => {
    expect(prefillFromQuery({ type: "plan", city: "Hong Kong", checkIn: "2027-01-16" })?.fields).toEqual({});
  });
});

const hint: ItemFormProps["hint"] = async () => ({ status: "empty" });

describe("the form with that prefill", () => {
  const html = renderToStaticMarkup(
    createElement(ItemForm, {
      tripId: "00000000-0000-4000-8300-000000000001",
      travelers: [],
      members: [],
      initial: prefillFromQuery(stay),
      action: async (prev) => prev,
      hint,
      canChangeSharing: false,
      backHref: "/",
    }),
  );

  it("opens on Stay with Hong Kong and both dates filled in", () => {
    expect(html).toMatch(/<input[^>]*name="type"[^>]*checked=""[^>]*value="stay"/);
    expect(html).toMatch(/<input[^>]*name="place"[^>]*value="Hong Kong"/);
    expect(html).toMatch(/<input[^>]*name="checkInDate"[^>]*value="2027-01-16"/);
    expect(html).toMatch(/<input[^>]*name="checkOutDate"[^>]*value="2027-01-27"/);
  });
});
