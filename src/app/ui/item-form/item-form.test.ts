import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { buildFixtureTrip, TRAVELERS, USERS } from "@/fixtures/december-trip";
import { itemToFormValues } from "@/domain/import/item-form";
import { projectTrip } from "@/domain/visibility/project";
import { present } from "@/testing/present";
import { ItemForm } from "./item-form";
import { parseFlash } from "./flash-status";
import { FLASH_COOKIE, FLASH_TEXT } from "./flash";

vi.mock("next/navigation", () => ({ useSearchParams: () => new URLSearchParams() }));

const view = projectTrip(buildFixtureTrip(), { kind: "member", userId: USERS.kenny.id, homeZone: "America/New_York" });
const nh159 = present(view.items.find((i) => i.flight?.flightNumber === "NH159"));

function editForm(travelers: { id: string; name: string }[], focusField: string | null = null): string {
  return renderToStaticMarkup(
    createElement(ItemForm, {
      tripId: view.trip.id,
      travelers,
      members: [],
      initial: itemToFormValues(nh159, travelers),
      action: async () => ({ errors: {}, message: null, values: [] }),
      hint: async () => ({ status: "empty" as const }),
      canChangeSharing: false,
      submitLabel: "Save changes",
      backLabel: "Cancel",
      backHref: `/trips/${view.trip.id}/items/${nh159.id}`,
      editing: { itemId: nh159.id, title: "NH159 to Tokyo", focusField },
    }),
  );
}

describe("edit form", () => {
  it("shows one confirmation code field per traveler under one legend when two are flying", () => {
    const html = editForm(view.travelers);
    expect(html).toContain("<legend>Confirmation code</legend>");
    expect(html).toContain("Fill in one if you share a code.");
    expect(html).toContain(`name="code:${TRAVELERS.kenny}"`);
    expect(html).toContain(`name="code:${TRAVELERS.jacob}"`);
    expect(html).toContain(">Kenneth<");
    expect(html).toContain(">Jacob<");
  });

  it("shows one plain field for one traveler", () => {
    const html = editForm(view.travelers.slice(0, 1));
    expect(html).toContain(">Confirmation code<");
    expect(html).toContain('name="confirmationCode"');
    expect(html).not.toContain("Fill in one");
  });

  it("has no type picker, no deadline fields and no sharing choices, and says Save changes and Cancel", () => {
    const html = editForm(view.travelers);
    for (const text of ["What are you adding", "Free cancellation until", "Who can see this"]) expect(html).not.toContain(text);
    expect(html).toContain("Save changes");
    expect(html).toContain(">Cancel<");
    expect(html).toContain('<input type="hidden" name="type" value="flight"/>');
  });

  it("opens More details with codes that stay off autocorrect and capitalisation", () => {
    const html = editForm(view.travelers, `seat:${TRAVELERS.jacob}`);
    expect(html).toContain("More details");
    expect(html).toContain(`autoCapitalize="characters"`);
    expect(html).toContain('spellCheck="false"');
    expect(html).toContain('autoComplete="off"');
    expect(html).toContain("Booking reference");
  });
});

describe("flash cookie", () => {
  it("reads only the kind of flash", () => {
    expect(parseFlash("deleted")).toBe("deleted");
    expect(parseFlash("saved")).toBe("saved");
    expect(parseFlash("")).toBeNull();
    expect(parseFlash("NH159%20to%20Tokyo")).toBeNull();
    expect(FLASH_COOKIE).toBe("trip-flash");
  });

  it("is set with the kind alone, on the trip's own path, and never carries a title", async () => {
    const set = vi.fn();
    vi.doMock("next/headers", () => ({ cookies: async () => ({ set }) }));
    const { setFlash } = await import("./set-flash");
    await setFlash("deleted", view.trip.id);
    expect(set).toHaveBeenCalledWith("trip-flash", "deleted", expect.objectContaining({ path: `/trips/${view.trip.id}`, maxAge: 60, sameSite: "lax" }));
    expect(JSON.stringify(set.mock.calls)).not.toContain("NH159");
    expect(FLASH_TEXT.deleted).toBe("Item deleted.");
  });
});
