import { present } from "@/testing/present";
import { describe, expect, it } from "vitest";
import { buildFixtureTrip, byFlight, fixtureItem, USERS, TRIP_ID } from "@/fixtures/december-trip";
import { fromLocal } from "../time/format";
import type { Item, Requester, TripAggregate } from "../types";
import { AccessDenied, assertCanEditItem, projectTrip } from "./project";

const NY = "America/New_York";
const VIEWER = { id: "user-mom", name: "Mom" };
const owner: Requester = { kind: "member", userId: USERS.kenny.id, homeZone: NY };
const editor: Requester = { kind: "member", userId: USERS.jacob.id, homeZone: NY };
const viewer: Requester = { kind: "member", userId: VIEWER.id, homeZone: NY };
const link: Requester = { kind: "link", homeZone: "Europe/London" };

function tripWithViewer(): TripAggregate {
  const t = buildFixtureTrip();
  t.memberships.push({ tripId: TRIP_ID, userId: VIEWER.id, role: "viewer" });
  return t;
}

function surprise(overrides: Partial<Item>): Item {
  const base = present(buildFixtureTrip().items.find((i) => i.type === "plan"));
  return {
    ...base,
    id: "item-surprise",
    title: "Birthday dinner for Kenny at Sukiyabashi",
    start: fromLocal("2026-12-03T19:00", "Asia/Tokyo"),
    end: fromLocal("2026-12-03T21:00", "Asia/Tokyo"),
    location: { name: "Sukiyabashi", city: "Tokyo" },
    createdBy: USERS.jacob.id,
    updatedBy: USERS.jacob.id,
    visibility: "only_me",
    private: [{ travelerId: null, confirmationCode: "SECRET_DINNER", phone: "+81 3 0000 0000" }],
    deadlines: [],
    ...overrides,
  };
}

const json = (x: unknown) => JSON.stringify(x);

describe("projectTrip: sensitive fields", () => {
  it("owner and editor see confirmation codes and seats", () => {
    for (const r of [owner, editor]) {
      const nh159 = present(projectTrip(tripWithViewer(), r).items.find((i) => i.flight?.flightNumber === "NH159"));
      expect(nh159.private.map((p) => p.seat).sort()).toEqual(["30C", "30K"]);
    }
  });

  it.each([
    ["invited viewer", viewer],
    ["view link visitor", link],
  ])("%s never receives codes, seats or prices anywhere in the payload", (_name, r) => {
    const agg = tripWithViewer();
    fixtureItem(agg, byFlight("CX509")).private.push({ travelerId: null, price: { amount: "1183.22", currency: "USD" }, bookingReference: "PLACEHOLDER_C" });
    const out = json(projectTrip(agg, r));
    for (const secret of ["PLACEHOLDER_A", "PLACEHOLDER_B", "PLACEHOLDER_C", "30K", "30C", "1183.22"]) {
      expect(out).not.toContain(secret);
    }
  });

  it("link visitors do not receive user ids", () => {
    const out = json(projectTrip(tripWithViewer(), link));
    for (const id of [USERS.kenny.id, USERS.jacob.id, VIEWER.id]) expect(out).not.toContain(id);
  });
});

describe("projectTrip: hidden items", () => {
  it("an only-me item created by an editor is invisible to the owner, including counts", () => {
    const agg = tripWithViewer();
    agg.items.push(surprise({}));
    const view = projectTrip(agg, owner);
    expect(view.items).toHaveLength(agg.items.length - 1);
    expect(view.busy).toHaveLength(0);
    expect(json(view)).not.toMatch(/Sukiyabashi|Birthday|SECRET_DINNER|item-surprise/);
  });

  it("the creator sees their own hidden item", () => {
    const agg = tripWithViewer();
    agg.items.push(surprise({}));
    expect(projectTrip(agg, editor).items.some((i) => i.id === "item-surprise")).toBe(true);
  });

  it("a busy item shows only as Busy, with no title, place, id or details", () => {
    const agg = tripWithViewer();
    agg.items.push(surprise({ showAsBusy: true }));
    for (const r of [owner, viewer, link]) {
      const view = projectTrip(agg, r);
      expect(view.busy).toHaveLength(1);
      expect(Object.keys(view.busy[0]).sort()).toEqual(["end", "key", "start"]);
      expect(json(view)).not.toMatch(/Sukiyabashi|Birthday|SECRET_DINNER|item-surprise/);
    }
  });

  it("identical hidden busy items collapse to one block, so their number stays private", () => {
    const agg = tripWithViewer();
    agg.items.push(surprise({ id: "item-a", showAsBusy: true }), surprise({ id: "item-b", showAsBusy: true }));
    for (const r of [owner, viewer, link]) expect(projectTrip(agg, r).busy).toHaveLength(1);
  });

  it("a busy block is placed in the zone the viewer is in, not the hidden item's zone", () => {
    const agg = tripWithViewer();
    agg.items.push(surprise({ showAsBusy: true, start: fromLocal("2026-12-03T19:00", "Asia/Seoul"), end: fromLocal("2026-12-03T21:00", "Asia/Seoul") }));
    const view = projectTrip(agg, owner);
    expect(view.busy.map((b) => [b.start.zone, b.end.zone]).flat()).not.toContain("Asia/Seoul");
  });

  it("specific people: chosen members see it, others do not", () => {
    const agg = tripWithViewer();
    agg.items.push(surprise({ visibility: "specific", visibleToUserIds: [VIEWER.id] }));
    expect(projectTrip(agg, viewer).items.some((i) => i.id === "item-surprise")).toBe(true);
    expect(projectTrip(agg, owner).items.some((i) => i.id === "item-surprise")).toBe(false);
    expect(projectTrip(agg, link).items.some((i) => i.id === "item-surprise")).toBe(false);
  });

  it("only the creator learns who an item is shared with", () => {
    const agg = tripWithViewer();
    agg.items.push(surprise({ visibility: "specific", visibleToUserIds: [VIEWER.id] }));
    expect(present(projectTrip(agg, viewer).items.find((i) => i.id === "item-surprise")).visibleToUserIds).toEqual([]);
    expect(present(projectTrip(agg, editor).items.find((i) => i.id === "item-surprise")).visibleToUserIds).toEqual([VIEWER.id]);
  });

  it("the owner cannot edit an item hidden from them", () => {
    const agg = tripWithViewer();
    const hidden = surprise({});
    agg.items.push(hidden);
    expect(() => assertCanEditItem(agg, owner, hidden)).toThrow(AccessDenied);
    expect(() => assertCanEditItem(agg, editor, hidden)).not.toThrow();
  });
});

describe("projectTrip: deadlines switches", () => {
  const hasDeadlines = (agg: TripAggregate, r: Requester) =>
    projectTrip(agg, r).items.some((i) => i.deadlines.length > 0);

  it("editors always see deadlines", () => {
    expect(hasDeadlines(tripWithViewer(), editor)).toBe(true);
  });

  it("invited viewers see deadlines only when the owner allows it", () => {
    const agg = tripWithViewer();
    expect(hasDeadlines(agg, viewer)).toBe(false);
    agg.trip.viewersSeeDeadlines = true;
    expect(hasDeadlines(agg, viewer)).toBe(true);
    expect(hasDeadlines(agg, link)).toBe(false);
  });

  it("the view link has its own switch", () => {
    const agg = tripWithViewer();
    agg.shareLink = { enabled: true, showsDeadlines: true };
    expect(hasDeadlines(agg, link)).toBe(true);
    expect(hasDeadlines(agg, viewer)).toBe(false);
  });

  it("a link visitor who sees deadlines never receives the id of the person who confirmed one", () => {
    const agg = tripWithViewer();
    agg.shareLink = { enabled: true, showsDeadlines: true };
    const confirmed = present(agg.items.flatMap((i) => i.deadlines).find((d) => d.confirmedBy === USERS.kenny.id));
    const out = json(projectTrip(agg, link));
    expect(out).not.toContain(USERS.kenny.id);
    const view = projectTrip(agg, link);
    expect(present(view.items.flatMap((i) => i.deadlines).find((d) => d.id === confirmed.id)).confirmed).toBe(true);
  });
});

describe("projectTrip: access", () => {
  it("rejects non members and disabled links", () => {
    const agg = tripWithViewer();
    expect(() => projectTrip(agg, { kind: "member", userId: "stranger", homeZone: NY })).toThrow(AccessDenied);
    agg.shareLink = { enabled: false, showsDeadlines: false };
    expect(() => projectTrip(agg, link)).toThrow(AccessDenied);
  });

  it("uses the stored membership role, not the role the requester claims", () => {
    const agg = tripWithViewer();
    const claimsOwner = { ...viewer, role: "owner" };
    const view = projectTrip(agg, claimsOwner);
    expect(view.permissions.canSeeSensitive).toBe(false);
  });
});
