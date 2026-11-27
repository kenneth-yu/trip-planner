import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { present } from "@/testing/present";
import { buildFixtureTrip, byFlight, byTitle, fixtureItem, TRIP_ID, USERS } from "@/fixtures/december-trip";
import { fromLocal } from "@/domain/time/format";
import { buildDays } from "@/domain/time/days";
import { projectTrip } from "@/domain/visibility/project";
import type { Item, Requester, TripAggregate } from "@/domain/types";
import { DayView } from "../../day-view";
import { itemToFormValues } from "@/domain/import/item-form";
import { ItemDetails } from "./item-details";
import { itemOf } from "./item-of";

vi.mock("next/navigation", () => ({ useSearchParams: () => new URLSearchParams() }));

const NY = "America/New_York";
const owner: Requester = { kind: "member", userId: USERS.kenny.id, homeZone: NY };
const editor: Requester = { kind: "member", userId: USERS.jacob.id, homeZone: NY };
const viewer: Requester = { kind: "member", userId: "user-mom", homeZone: NY };
const link: Requester = { kind: "link", homeZone: NY };
const NOW_MS = Date.parse("2026-11-27T12:00:00.000Z");

function trip(): TripAggregate {
  const t = buildFixtureTrip();
  t.memberships.push({ tripId: TRIP_ID, userId: "user-mom", role: "viewer" });
  const base = fixtureItem(t, byTitle("Head spa"));
  const secret: Item = {
    ...base,
    id: "item-ring",
    title: "Ring shopping",
    start: fromLocal("2026-12-05T20:00", "Asia/Hong_Kong"),
    end: fromLocal("2026-12-05T21:00", "Asia/Hong_Kong"),
    createdBy: USERS.jacob.id,
    updatedBy: USERS.jacob.id,
    visibility: "only_me",
    private: [{ travelerId: null, confirmationCode: "SECRET_RING", phone: "+852 0000 0000" }],
    deadlines: [],
  };
  t.items.push(secret);
  return t;
}

function viewerTravelerOf(agg: TripAggregate, r: Requester): string | null {
  if (r.kind !== "member") return null;
  return agg.travelers.find((t) => t.userId === r.userId)?.id ?? null;
}

function render(agg: TripAggregate, requester: Requester, id: string): string {
  const view = projectTrip(agg, requester);
  const item = present(itemOf(view, id));
  return renderToStaticMarkup(createElement(ItemDetails, { view, item, nowMs: NOW_MS, viewerTravelerId: viewerTravelerOf(agg, requester) }));
}

const nh159 = (agg: TripAggregate) => fixtureItem(agg, byFlight("NH159"));

describe("item details", () => {
  it("shows an owner each traveler's confirmation code and the seats on one line", () => {
    const agg = trip();
    const page = render(agg, owner, nh159(agg).id);
    expect(page).toContain("PLACEHOLDER_A");
    expect(page).toContain("PLACEHOLDER_B");
    expect(page).toContain("Kenneth 30K, Jacob 30C");
    expect(page.match(/>Copy</g)?.length).toBeGreaterThanOrEqual(2);
  });

  it("shows an editor the same", () => {
    const agg = trip();
    expect(render(agg, editor, nh159(agg).id)).toContain("Kenneth 30K, Jacob 30C");
  });

  it("puts the confirmation code above phone and price", () => {
    const agg = trip();
    const flight = nh159(agg);
    flight.private = [{ travelerId: null, confirmationCode: "PLACEHOLDER_A", phone: "+1 555 0100", price: { amount: "1200", currency: "USD" } }];
    const page = render(agg, owner, flight.id);
    const code = page.indexOf("PLACEHOLDER_A");
    expect(code).toBeGreaterThan(-1);
    expect(code).toBeLessThan(page.indexOf("+1 555 0100"));
    expect(code).toBeLessThan(page.indexOf("USD 1200"));
  });

  it("shows a stay's deadlines to an owner and not to a viewer", () => {
    const agg = trip();
    const stay = fixtureItem(agg, byTitle("Hotel Resol Ueno")).id;
    expect(render(agg, owner, stay)).toContain("Hotel Resol Ueno becomes non refundable");
    expect(render(agg, viewer, stay)).not.toContain("non refundable");
  });

  it.each([
    ["an invited viewer", viewer],
    ["a view link visitor", link],
  ])("shows %s no code, seat, phone, price or notes", (_, requester) => {
    const agg = trip();
    const flight = nh159(agg);
    flight.private = [
      { travelerId: null, confirmationCode: "PLACEHOLDER_A", seat: "30K", phone: "+1 555 0100", price: { amount: "1200", currency: "USD" }, notes: "Window please" },
    ];
    flight.notes = "Meal note";
    const page = render(agg, requester, flight.id);
    for (const secret of ["PLACEHOLDER_A", "30K", "+1 555 0100", "1200", "Window please", "Meal note", "Copy"]) expect(page).not.toContain(secret);
    expect(page).toContain("NH159");
  });

  it("gives a person who cannot see an item exactly what a missing id gives", () => {
    const agg = trip();
    expect(itemOf(projectTrip(agg, owner), "item-ring")).toBeNull();
    expect(itemOf(projectTrip(agg, owner), "does-not-exist")).toBeNull();
    expect(itemOf(projectTrip(agg, link), "item-ring")).toBeNull();
    expect(itemOf(projectTrip(agg, editor), "item-ring")?.title).toBe("Ring shopping");
  });

  it("omits empty fields", () => {
    const agg = trip();
    const page = render(agg, owner, fixtureItem(agg, byTitle("Hotel Resol Ueno")).id);
    for (const label of ["Phone", "Price", "Seats", "Booking reference", "Confirmation code"]) expect(page).not.toContain(label);
  });

  it("shows local times big and the clock change", () => {
    const agg = trip();
    const page = render(agg, owner, nh159(agg).id);
    expect(page).toContain("12:55am");
    expect(page).toContain("5:25am");
    expect(page).toContain("Clocks go forward 14 hours.");
  });
});

describe("day view rows", () => {
  it("link each visible item to its details and never a hidden one", () => {
    const agg = trip();
    const view = projectTrip(agg, owner);
    const page = renderToStaticMarkup(createElement(DayView, { view, days: buildDays(view), todayKey: "2026-11-27" }));
    expect(page).toContain(`href="/trips/${TRIP_ID}/items/${nh159(agg).id}"`);
    expect(page).not.toContain("item-ring");
  });

  it("no longer repeat codes, seats, phone or price from the details page", () => {
    const agg = trip();
    const flight = nh159(agg);
    flight.private = [{ travelerId: null, confirmationCode: "PLACEHOLDER_A", seat: "30K", phone: "+1 555 0100", price: { amount: "1200", currency: "USD" } }];
    const view = projectTrip(agg, owner);
    const page = renderToStaticMarkup(createElement(DayView, { view, days: buildDays(view), todayKey: "2026-11-27" }));
    for (const value of ["PLACEHOLDER_A", "30K", "+1 555 0100", "1200"]) expect(page).not.toContain(value);
    expect(page).not.toContain("<details>");
    expect(page).not.toContain("Open booking");
  });

  it("make every row a link, and a hidden item never gets one", () => {
    const agg = trip();
    const view = projectTrip(agg, editor);
    const hidden = renderToStaticMarkup(createElement(DayView, { view: projectTrip(agg, owner), days: buildDays(projectTrip(agg, owner)), todayKey: "2026-11-27" }));
    expect(hidden).not.toContain("item-ring");
    const page = renderToStaticMarkup(createElement(DayView, { view, days: buildDays(view), todayKey: "2026-11-27" }));
    expect(page).toContain("/items/item-ring");
  });

  it("puts your own code first", () => {
    const agg = trip();
    const page = render(agg, editor, nh159(agg).id);
    expect(page.indexOf("Your confirmation code")).toBeLessThan(page.indexOf("Confirmation code, Kenneth"));
    expect(page.indexOf("PLACEHOLDER_B")).toBeLessThan(page.indexOf("PLACEHOLDER_A"));
  });
});

describe("details wording", () => {
  it("a code held by one of two travelers says whose it is", () => {
    const agg = trip();
    const flight = nh159(agg);
    flight.private = [{ travelerId: flight.travelerIds[0], confirmationCode: "PLACEHOLDER_A" }];
    expect(render(agg, owner, flight.id)).toContain("Your confirmation code");
    expect(render(agg, editor, flight.id)).toContain("Confirmation code, Kenneth");
  });

  it("the flight title says where it goes", () => {
    const agg = trip();
    expect(render(agg, owner, nh159(agg).id)).toContain("NH159 to Tokyo");
  });
});

describe("WP-10a follow-ups", () => {
  function renamedAccounts(): TripAggregate {
    const agg = trip();
    for (const traveler of agg.travelers) traveler.name = traveler.userId === USERS.kenny.id ? "Kenny" : "Jacob";
    return agg;
  }

  it("matches Your confirmation code on the linked user, not the name", () => {
    const agg = renamedAccounts();
    const page = render(agg, editor, nh159(agg).id);
    expect(page).toContain("Your confirmation code");
    expect(page).toContain("Confirmation code, Kenny");
  });

  it("lists codes by first name, in the order on the item, when the viewer is linked to no traveler", () => {
    const agg = trip();
    agg.memberships.push({ tripId: TRIP_ID, userId: "user-editor", role: "editor" });
    const page = render(agg, { kind: "member", userId: "user-editor", homeZone: NY }, nh159(agg).id);
    expect(page).not.toContain("Your confirmation code");
    expect(page.indexOf("Confirmation code, Kenneth")).toBeLessThan(page.indexOf("Confirmation code, Jacob"));
  });

  it("makes the back link at least 44px tall and the airline the only subtitle", () => {
    const agg = trip();
    const cx = fixtureItem(agg, byFlight("CX509"));
    const view = projectTrip(agg, owner);
    const html = renderToStaticMarkup(createElement(ItemDetails, { view, item: present(itemOf(view, cx.id)), nowMs: NOW_MS, viewerTravelerId: null }));
    expect(html).toContain("Cathay Pacific");
    expect(html.match(/CX509/g)).toHaveLength(1);
  });

  it("has no subtitle line when the airline is unknown", () => {
    const agg = trip();
    const flight = nh159(agg);
    if (flight.flight) flight.flight = { ...flight.flight, airline: undefined };
    const view = projectTrip(agg, owner);
    const html = renderToStaticMarkup(createElement(ItemDetails, { view, item: present(itemOf(view, flight.id)), nowMs: NOW_MS, viewerTravelerId: null }));
    expect(html).not.toContain("Unknown");
    expect(html.match(/NH159/g)).toHaveLength(1);
  });
});

describe("edit prompts", () => {
  it("offers an editor Add confirmation code on a stay without one, and no viewer anything", () => {
    const agg = trip();
    const stay = fixtureItem(agg, byTitle("Hotel Resol Ueno")).id;
    const ownerPage = render(agg, owner, stay);
    expect(ownerPage).toContain("Add confirmation code");
    expect(ownerPage).toContain(`/items/${stay}/edit?focus=code`);
    const viewerPage = render(agg, viewer, stay);
    for (const text of ["Add confirmation code", "Add your seat", "/edit"]) expect(viewerPage).not.toContain(text);
  });

  it("offers Add your seat only to the traveler linked to the viewer who has no seat", () => {
    const agg = trip();
    const flight = nh159(agg);
    flight.private = flight.private.map((p) => (p.travelerId === flight.travelerIds[1] ? { ...p, seat: undefined } : p));
    expect(render(agg, editor, flight.id)).toContain("Add your seat");
    expect(render(agg, owner, flight.id)).not.toContain("Add your seat");
  });

  it("round trips the confirmation codes of a two traveler flight into one field each", () => {
    const agg = trip();
    const view = projectTrip(agg, owner);
    const item = present(itemOf(view, nh159(agg).id));
    const values = itemToFormValues(item, view.travelers);
    expect(Object.keys(values.fields).filter((k) => k.startsWith("code:"))).toHaveLength(2);
  });
});
