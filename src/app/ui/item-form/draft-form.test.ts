import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { ItemFormValues } from "@/domain/import/item-form";
import { ItemForm, type ItemFormProps } from "./item-form";

const hint: ItemFormProps["hint"] = async () => ({ status: "empty" });
const action: ItemFormProps["action"] = async (prev) => prev;

function values(fields: Record<string, string>, type: ItemFormValues["type"] = "flight"): ItemFormValues {
  return { type, fields, seats: [], visibility: "everyone", visibleToUserIds: [], showAsBusy: false };
}

function render(props: Partial<ItemFormProps>) {
  return renderToStaticMarkup(
    createElement(ItemForm, {
      tripId: "00000000-0000-4000-8300-000000000001",
      travelers: [{ id: "t1", name: "Kenneth Yu" }],
      members: [],
      action,
      hint,
      canChangeSharing: false,
      backHref: "/",
      ...props,
    }),
  );
}

const checked = (html: string, value: string) => new RegExp(`<input[^>]*name="booked"[^>]*checked=""[^>]*value="${value}"`).test(html);

describe("Is it booked?", () => {
  it("asks with Yes and Not yet as a native radio group", () => {
    const html = render({});
    expect(html).toContain("<legend>Is it booked?</legend>");
    expect(html).toMatch(/name="booked"[^>]*value="yes"/);
    expect(html).toMatch(/name="booked"[^>]*value="no"/);
    expect(html).toContain("Not yet");
  });

  it("defaults to Yes, and to Not yet on a trip with nothing booked", () => {
    expect(checked(render({}), "yes")).toBe(true);
    expect(checked(render({ defaultBooked: false }), "no")).toBe(true);
  });

  it("goes back to Yes when a flight number is already filled in", () => {
    expect(checked(render({ defaultBooked: false, initial: values({ flightNumber: "CX 845" }) }), "yes")).toBe(true);
  });

  it("follows what an item already is, and what a link asked for", () => {
    expect(checked(render({ initial: values({ booked: "no" }) }), "no")).toBe(true);
    expect(checked(render({ defaultBooked: false, initial: values({ booked: "yes" }) }), "yes")).toBe(true);
  });
});

describe("a draft flight", () => {
  const html = render({ initial: values({ booked: "no", notes: "Window please" }) });

  it("says the number is optional and asks about how long it takes, with visible labels", () => {
    expect(html).toContain("Optional.");
    expect(html).toContain("<legend>About how long?</legend>");
    expect(html).toMatch(/<label[^>]*>Hours<\/label>/);
    expect(html).toMatch(/<label[^>]*>Minutes<\/label>/);
  });

  it("leaves out the details that only exist once booked, and keeps notes and phone", () => {
    expect(html).not.toContain("Confirmation code");
    expect(html).not.toContain("Seats");
    expect(html).not.toContain("Price");
    expect(html).not.toContain("Free cancellation until");
    expect(html).toContain("Phone");
    expect(html).toContain("Notes");
  });

  it("a booked flight shows them, and not the flight time", () => {
    const booked = render({ initial: values({ booked: "yes", notes: "x" }) });
    expect(booked).toContain("Confirmation code");
    expect(booked).toContain("Price");
    expect(booked).not.toContain("About how long?");
  });
});
