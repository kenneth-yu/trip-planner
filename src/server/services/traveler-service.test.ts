import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { buildFixtureTrip, TRAVELERS, TRIP_ID, USERS } from "@/fixtures/december-trip";
import { AccessDenied, projectTrip } from "@/domain/visibility/project";
import { InputProblem } from "@/domain/import/quick-add";
import { removalRefusal } from "@/domain/travelers/removal";
import type { Item, Requester } from "@/domain/types";
import { present } from "@/testing/present";
import * as t from "../db/schema";
import { listActivity } from "../repo/activity-repo";
import { loadTripAggregate, saveItem, UnknownTraveler } from "../repo/trip-repo";
import { jacob, kenny, testContext } from "../testing";
import { NotFound, updateItem } from "./trip-service";
import { removeMember } from "./sharing-service";
import { addTraveler, getTravelerSettings, linkTraveler, removeTraveler, renameTraveler, renameTrip } from "./traveler-service";

const VIEWER = { id: "00000000-0000-4000-8100-000000000b01", name: "Mom Feldman" };
const STRANGER = { id: "00000000-0000-4000-8100-000000000b02", name: "Pat Stranger" };
const NEWCOMER = { id: "00000000-0000-4000-8100-000000000b03", name: "Maya Chen" };
const asMember = (userId: string): Requester => ({ kind: "member", userId, homeZone: "America/New_York" });
const viewer = asMember(VIEWER.id);
const stranger = asMember(STRANGER.id);
const newcomer = asMember(NEWCOMER.id);
const linkVisitor: Requester = { kind: "link", homeZone: "UTC" };
const CANARY = "Ring shopping at Mikimoto CANARY";

async function setup() {
  const world = await testContext();
  await world.db.insert(t.users).values([
    { id: VIEWER.id, name: VIEWER.name, email: "mom@example.com" },
    { id: STRANGER.id, name: STRANGER.name, email: "pat@example.com" },
    { id: NEWCOMER.id, name: NEWCOMER.name, email: "maya@example.com" },
  ]);
  await world.db.insert(t.memberships).values({ tripId: TRIP_ID, userId: VIEWER.id, role: "viewer" });
  return world;
}

type World = Awaited<ReturnType<typeof setup>>;

async function planFor(world: World, travelerIds: string[], overrides: Partial<Item> = {}): Promise<Item> {
  const base = present(buildFixtureTrip().items.find((i) => i.type === "plan"));
  const item: Item = { ...base, id: randomUUID(), travelerIds, private: [], deadlines: [], visibility: "everyone", visibleToUserIds: [], showAsBusy: false, ...overrides };
  await saveItem(world.db, item);
  return item;
}

async function freshTraveler(world: World, name = "Maya Chen"): Promise<string> {
  return (await addTraveler(world.ctx, TRIP_ID, kenny, name)).id;
}

async function messageOf(run: () => Promise<unknown>): Promise<string> {
  try {
    await run();
    return "";
  } catch (e) {
    return e instanceof Error ? `${e.name}: ${e.message}` : "";
  }
}

describe("who may use each action", () => {
  const actions: [string, (w: World, tripId: string, r: Requester, travelerId: string) => Promise<unknown>][] = [
    ["rename trip", (w, tripId, r) => renameTrip(w.ctx, tripId, r, "Renamed")],
    ["add traveler", (w, tripId, r) => addTraveler(w.ctx, tripId, r, "Sam Ortiz")],
    ["rename traveler", (w, tripId, r, id) => renameTraveler(w.ctx, tripId, r, id, "Sam Ortiz")],
    ["link traveler", (w, tripId, r, id) => linkTraveler(w.ctx, tripId, r, id, NEWCOMER.id)],
    ["remove traveler", (w, tripId, r, id) => removeTraveler(w.ctx, tripId, r, id)],
    ["read settings", (w, tripId, r) => getTravelerSettings(w.ctx, tripId, r)],
  ];
  const outsiders: [string, Requester][] = [
    ["a viewer", viewer],
    ["a view link visitor", linkVisitor],
    ["a stranger", stranger],
  ];

  it.each(actions)("%s is refused for a viewer, a view link visitor and a stranger exactly like a missing trip", async (_name, run) => {
    const world = await setup();
    const travelerId = await freshTraveler(world);
    await world.db.insert(t.memberships).values({ tripId: TRIP_ID, userId: NEWCOMER.id, role: "editor" });
    const before = JSON.stringify(await loadTripAggregate(world.db, TRIP_ID));
    for (const [, requester] of outsiders) {
      const refused = await messageOf(() => run(world, TRIP_ID, requester, travelerId));
      const missing = await messageOf(() => run(world, randomUUID(), requester, travelerId));
      expect(refused).toMatch(/^NotFound: /);
      expect(refused).toBe(missing);
    }
    expect(JSON.stringify(await loadTripAggregate(world.db, TRIP_ID))).toBe(before);
  });

  it("a removed member is refused like a stranger", async () => {
    const world = await setup();
    await world.db.insert(t.memberships).values({ tripId: TRIP_ID, userId: NEWCOMER.id, role: "editor" });
    await removeMember(world.ctx, TRIP_ID, kenny, NEWCOMER.id);
    await expect(addTraveler(world.ctx, TRIP_ID, newcomer, "Sam Ortiz")).rejects.toThrow(NotFound);
  });

  it("an editor can add, rename, link and remove travelers but not rename the trip", async () => {
    const world = await setup();
    await world.db.insert(t.memberships).values({ tripId: TRIP_ID, userId: NEWCOMER.id, role: "viewer" });
    const sam = await addTraveler(world.ctx, TRIP_ID, jacob, "Sam Ortiz");
    await renameTraveler(world.ctx, TRIP_ID, jacob, sam.id, "Samuel Ortiz");
    await linkTraveler(world.ctx, TRIP_ID, jacob, sam.id, NEWCOMER.id);
    const extra = await addTraveler(world.ctx, TRIP_ID, jacob, "Lee Park");
    expect(await removeTraveler(world.ctx, TRIP_ID, jacob, extra.id)).toEqual({ status: "removed", name: "Lee Park" });
    await expect(renameTrip(world.ctx, TRIP_ID, jacob, "Jacob's rename")).rejects.toThrow(AccessDenied);
    expect(present(await loadTripAggregate(world.db, TRIP_ID)).trip.name).not.toBe("Jacob's rename");
  });
});

describe("renaming the trip", () => {
  it("lets the owner save a trimmed name, up to 80 characters, stored as text", async () => {
    const { ctx, db } = await setup();
    expect(await renameTrip(ctx, TRIP_ID, kenny, "  <b>Asia</b> 🎌  ")).toEqual({ name: "<b>Asia</b> 🎌" });
    const name80 = "x".repeat(80);
    await renameTrip(ctx, TRIP_ID, kenny, name80);
    expect(present(await loadTripAggregate(db, TRIP_ID)).trip.name).toBe(name80);
  });

  it("refuses an empty, blank or 81 character name with the copy on the page", async () => {
    const { ctx } = await setup();
    await expect(renameTrip(ctx, TRIP_ID, kenny, "   ")).rejects.toThrow("Give the trip a name.");
    await expect(renameTrip(ctx, TRIP_ID, kenny, "x".repeat(81))).rejects.toThrow("Keep the name under 80 characters.");
    await expect(renameTrip(ctx, TRIP_ID, kenny, 42)).rejects.toThrow(InputProblem);
  });

  it("records a sealed activity row, tells the mirrors, and keeps the name out of nothing else", async () => {
    const { ctx, db, changed } = await setup();
    await renameTrip(ctx, TRIP_ID, kenny, "Asia, take two");
    expect(changed).toEqual([TRIP_ID]);
    const entry = present((await listActivity(db, TRIP_ID)).find((a) => a.action === "trip_renamed"));
    expect(entry.after).toEqual({ name: "Asia, take two" });
    const [raw] = await db.select().from(t.activity).where(eq(t.activity.id, entry.id));
    expect(JSON.stringify(raw)).not.toContain("Asia, take two");
  });
});

describe("adding and renaming travelers", () => {
  it("refuses a duplicate in any case or spacing, empty names and long names", async () => {
    const { ctx } = await setup();
    await addTraveler(ctx, TRIP_ID, kenny, "Maya Chen");
    await expect(addTraveler(ctx, TRIP_ID, kenny, "  maya   chen ")).rejects.toThrow("There is already a traveler called maya chen.");
    await expect(addTraveler(ctx, TRIP_ID, kenny, "   ")).rejects.toThrow("Add a name.");
    await expect(addTraveler(ctx, TRIP_ID, kenny, "y".repeat(81))).rejects.toThrow("Keep the name under 80 characters.");
    await expect(addTraveler(ctx, TRIP_ID, kenny, null)).rejects.toThrow(InputProblem);
  });

  it("a double submit makes one traveler", async () => {
    const { ctx, db } = await setup();
    const results = await Promise.allSettled([addTraveler(ctx, TRIP_ID, kenny, "Sam Ortiz"), addTraveler(ctx, TRIP_ID, kenny, "Sam Ortiz")]);
    expect(results.map((r) => r.status).sort()).toEqual(["fulfilled", "rejected"]);
    const rows = await db.select().from(t.travelers).where(eq(t.travelers.tripId, TRIP_ID));
    expect(rows.filter((r) => r.name === "Sam Ortiz")).toHaveLength(1);
  });

  it("renaming to the same name is fine, to another traveler's name is not, and the item keeps its traveler", async () => {
    const world = await setup();
    const maya = await freshTraveler(world);
    const item = await planFor(world, [maya]);
    await renameTraveler(world.ctx, TRIP_ID, kenny, maya, "Maya Chen");
    await expect(renameTraveler(world.ctx, TRIP_ID, kenny, maya, "jacob feldman")).rejects.toThrow(InputProblem);
    await renameTraveler(world.ctx, TRIP_ID, kenny, maya, "Maya C. Chen");
    const agg = present(await loadTripAggregate(world.db, TRIP_ID));
    expect(agg.travelers.find((x) => x.id === maya)?.name).toBe("Maya C. Chen");
    expect(present(agg.items.find((i) => i.id === item.id)).travelerIds).toEqual([maya]);
  });

  it("a traveler id from another trip is not found here", async () => {
    const world = await setup();
    const otherTrip = randomUUID();
    await world.db.insert(t.trips).values({ id: otherTrip, name: "Other", ownerId: USERS.kenny.id });
    await world.db.insert(t.memberships).values({ tripId: otherTrip, userId: USERS.kenny.id, role: "owner" });
    const foreign = randomUUID();
    await world.db.insert(t.travelers).values({ id: foreign, tripId: otherTrip, name: "Sam Ortiz", userId: null });
    await expect(renameTraveler(world.ctx, TRIP_ID, kenny, foreign, "Hacked")).rejects.toThrow(NotFound);
    await expect(linkTraveler(world.ctx, TRIP_ID, kenny, foreign, USERS.kenny.id)).rejects.toThrow(NotFound);
    expect(await removeTraveler(world.ctx, TRIP_ID, kenny, foreign)).toEqual({ status: "gone" });
    const [row] = await world.db.select().from(t.travelers).where(eq(t.travelers.id, foreign));
    expect(present(row).name).toBe("Sam Ortiz");
  });

  it("tells the mirrors after each change", async () => {
    const world = await setup();
    const id = await freshTraveler(world);
    await renameTraveler(world.ctx, TRIP_ID, kenny, id, "Maya C.");
    await removeTraveler(world.ctx, TRIP_ID, kenny, id);
    expect(world.changed).toEqual([TRIP_ID, TRIP_ID, TRIP_ID]);
  });
});

describe("linking a traveler to a member", () => {
  it("links a member who has no traveler and shows the new relation", async () => {
    const world = await setup();
    await world.db.insert(t.memberships).values({ tripId: TRIP_ID, userId: NEWCOMER.id, role: "editor" });
    const maya = await freshTraveler(world);
    const before = await getTravelerSettings(world.ctx, TRIP_ID, kenny);
    expect(before.linkable.map((m) => m.userId).sort()).toEqual([VIEWER.id, NEWCOMER.id].sort());
    expect(before.travelers.find((x) => x.id === maya)?.relation).toEqual({ kind: "none" });
    await linkTraveler(world.ctx, TRIP_ID, kenny, maya, NEWCOMER.id);
    const after = await getTravelerSettings(world.ctx, TRIP_ID, kenny);
    expect(after.travelers.find((x) => x.id === maya)?.relation).toEqual({ kind: "matched" });
    expect(after.linkable.map((m) => m.userId)).not.toContain(NEWCOMER.id);
  });

  it("refuses a non-member, a user who does not exist, a member who already has a traveler and a traveler already linked, all with one sentence", async () => {
    const world = await setup();
    await world.db.insert(t.memberships).values({ tripId: TRIP_ID, userId: NEWCOMER.id, role: "editor" });
    const maya = await freshTraveler(world);
    const attempts = [
      () => linkTraveler(world.ctx, TRIP_ID, kenny, maya, STRANGER.id),
      () => linkTraveler(world.ctx, TRIP_ID, kenny, maya, randomUUID()),
      () => linkTraveler(world.ctx, TRIP_ID, kenny, maya, USERS.jacob.id),
      () => linkTraveler(world.ctx, TRIP_ID, kenny, TRAVELERS.jacob, NEWCOMER.id),
    ];
    const messages = await Promise.all(attempts.map(messageOf));
    expect(messages).toEqual(Array(4).fill("InputProblem: Pick someone from the list."));
    const [row] = await world.db.select().from(t.travelers).where(eq(t.travelers.id, maya));
    expect(present(row).userId).toBeNull();
  });

  it("two tabs linking the same member: the second is refused cleanly", async () => {
    const world = await setup();
    await world.db.insert(t.memberships).values({ tripId: TRIP_ID, userId: NEWCOMER.id, role: "editor" });
    const maya = await freshTraveler(world);
    const sam = await freshTraveler(world, "Sam Ortiz");
    const results = await Promise.allSettled([linkTraveler(world.ctx, TRIP_ID, kenny, maya, NEWCOMER.id), linkTraveler(world.ctx, TRIP_ID, jacob, sam, NEWCOMER.id)]);
    expect(results.map((r) => r.status).sort()).toEqual(["fulfilled", "rejected"]);
    const rows = await world.db.select().from(t.travelers).where(eq(t.travelers.userId, NEWCOMER.id));
    expect(rows).toHaveLength(1);
  });

  it("a traveler linked to a removed member reads as having no account", async () => {
    const world = await setup();
    await world.db.insert(t.memberships).values({ tripId: TRIP_ID, userId: NEWCOMER.id, role: "editor" });
    const maya = await freshTraveler(world);
    await linkTraveler(world.ctx, TRIP_ID, kenny, maya, NEWCOMER.id);
    await removeMember(world.ctx, TRIP_ID, kenny, NEWCOMER.id);
    const settings = await getTravelerSettings(world.ctx, TRIP_ID, kenny);
    expect(settings.travelers.find((x) => x.id === maya)?.relation).toEqual({ kind: "none" });
  });

  it("shows you, the account name only when it differs, and no account", async () => {
    const world = await setup();
    await world.db.update(t.travelers).set({ name: "Jake" }).where(eq(t.travelers.id, TRAVELERS.jacob));
    const asKenny = await getTravelerSettings(world.ctx, TRIP_ID, kenny);
    expect(asKenny.travelers.map((x) => x.relation)).toEqual([{ kind: "you" }, { kind: "account", accountName: "Jacob Feldman" }]);
    const asJacob = await getTravelerSettings(world.ctx, TRIP_ID, jacob);
    expect(asJacob.travelers.map((x) => x.relation)).toEqual([{ kind: "matched" }, { kind: "you" }]);
    expect(asJacob.canRename).toBe(false);
    expect(asKenny.canRename).toBe(true);
  });
});

describe("removing a traveler", () => {
  it("removes someone who is on nothing, and a second try says they are already gone", async () => {
    const world = await setup();
    const maya = await freshTraveler(world);
    expect(await removeTraveler(world.ctx, TRIP_ID, kenny, maya)).toEqual({ status: "removed", name: "Maya Chen" });
    expect(await removeTraveler(world.ctx, TRIP_ID, kenny, maya)).toEqual({ status: "gone" });
  });

  it("refuses your own traveler", async () => {
    const world = await setup();
    await expect(removeTraveler(world.ctx, TRIP_ID, kenny, TRAVELERS.kenny)).rejects.toThrow(InputProblem);
    expect(present(await loadTripAggregate(world.db, TRIP_ID)).travelers.map((x) => x.id)).toContain(TRAVELERS.kenny);
  });

  it("refuses while an item lists them and names the visible items", async () => {
    const world = await setup();
    const maya = await freshTraveler(world);
    const item = await planFor(world, [maya], { title: "Nozomi 17 to Kyoto" });
    const outcome = await removeTraveler(world.ctx, TRIP_ID, kenny, maya);
    expect(outcome).toEqual({ status: "refused", name: "Maya Chen", visible: [{ id: item.id, title: "Nozomi 17 to Kyoto", flightNumber: null, hasSeat: false }] });
    expect(present(await loadTripAggregate(world.db, TRIP_ID)).travelers.map((x) => x.id)).toContain(maya);
  });

  it("refuses over a seat on NH159 and says so with the flight", async () => {
    const world = await setup();
    const agg = present(await loadTripAggregate(world.db, TRIP_ID));
    const nh159 = present(agg.items.find((i) => i.flight?.flightNumber === "NH159"));
    const outcome = await removeTraveler(world.ctx, TRIP_ID, jacob, TRAVELERS.kenny);
    expect(outcome.status).toBe("refused");
    if (outcome.status !== "refused") return;
    expect(outcome.visible.some((v) => v.id === nh159.id && v.hasSeat)).toBe(true);
    const only = outcome.visible.filter((v) => v.id === nh159.id);
    expect(removalRefusal("Kenny Yu", only)).toEqual([{ text: "Kenny's seat is on " }, { item: { id: nh159.id, label: "NH159" } }, { text: ". Remove it from that flight first." }]);
  });

  it("a traveler only on an item hidden from the requester gets no title, no count, nothing", async () => {
    const world = await setup();
    const maya = await freshTraveler(world);
    await planFor(world, [maya], { title: CANARY, visibility: "only_me", createdBy: USERS.jacob.id, updatedBy: USERS.jacob.id });
    const none = await freshTraveler(world, "Sam Ortiz");
    const hiddenOnly = await removeTraveler(world.ctx, TRIP_ID, kenny, maya);
    expect(hiddenOnly).toEqual({ status: "refused", name: "Maya Chen", visible: [] });
    expect(JSON.stringify(hiddenOnly)).not.toContain(CANARY);
    expect(JSON.stringify(removalRefusal("Maya Chen", []))).not.toMatch(/CANARY|more|\d/);
    expect((await removeTraveler(world.ctx, TRIP_ID, kenny, none)).status).toBe("removed");
    expect(present(await loadTripAggregate(world.db, TRIP_ID)).travelers.map((x) => x.id)).toContain(maya);
  });

  it("a mixed case lists only the visible items and counts only those", async () => {
    const world = await setup();
    const maya = await freshTraveler(world);
    await planFor(world, [maya], { title: CANARY, visibility: "only_me", createdBy: USERS.jacob.id, updatedBy: USERS.jacob.id });
    const shown = await planFor(world, [maya], { title: "Dim sum at Tim Ho Wan" });
    const outcome = await removeTraveler(world.ctx, TRIP_ID, kenny, maya);
    expect(outcome).toEqual({ status: "refused", name: "Maya Chen", visible: [{ id: shown.id, title: "Dim sum at Tim Ho Wan", flightNumber: null, hasSeat: false }] });
    expect(JSON.stringify(outcome)).not.toContain(CANARY);
  });

  it("the owner of the hidden item still sees it among the visible ones", async () => {
    const world = await setup();
    const maya = await freshTraveler(world);
    const mine = await planFor(world, [maya], { title: CANARY, visibility: "only_me", createdBy: USERS.jacob.id, updatedBy: USERS.jacob.id });
    const outcome = await removeTraveler(world.ctx, TRIP_ID, jacob, maya);
    expect(outcome).toMatchObject({ status: "refused", visible: [{ id: mine.id }] });
  });

  it("a traveler seated on a flight blocks removal even when no item lists them", async () => {
    const world = await setup();
    const maya = await freshTraveler(world);
    await planFor(world, [], { title: "Seat only", private: [{ travelerId: maya, seat: "12A" }] });
    expect((await removeTraveler(world.ctx, TRIP_ID, kenny, maya)).status).toBe("refused");
  });
});

describe("races with item edits", () => {
  it.each([0, 1, 2, 3, 4])("removing a traveler while an edit adds them never leaves a dangling id (run %i)", async () => {
    const world = await setup();
    const maya = await freshTraveler(world);
    const item = await planFor(world, []);
    await Promise.allSettled([removeTraveler(world.ctx, TRIP_ID, kenny, maya), updateItem(world.ctx, TRIP_ID, item.id, jacob, { travelerIds: [maya] })]);
    const agg = present(await loadTripAggregate(world.db, TRIP_ID));
    const known = new Set(agg.travelers.map((x) => x.id));
    for (const i of agg.items) {
      for (const id of i.travelerIds) expect(known.has(id)).toBe(true);
      for (const p of i.private) if (p.travelerId) expect(known.has(p.travelerId)).toBe(true);
    }
  });

  it("an edit naming a traveler who was just removed is refused", async () => {
    const world = await setup();
    const maya = await freshTraveler(world);
    const item = await planFor(world, []);
    await removeTraveler(world.ctx, TRIP_ID, kenny, maya);
    await expect(updateItem(world.ctx, TRIP_ID, item.id, jacob, { travelerIds: [maya] })).rejects.toThrow(UnknownTraveler);
  });

  it("two removals of the same traveler at once: one removes, the other says gone", async () => {
    const world = await setup();
    const maya = await freshTraveler(world);
    const results = await Promise.all([removeTraveler(world.ctx, TRIP_ID, kenny, maya), removeTraveler(world.ctx, TRIP_ID, jacob, maya)]);
    expect(results.map((r) => r.status).sort()).toEqual(["gone", "removed"]);
  });
});

describe("what link visitors and viewers receive", () => {
  it("traveler data in a projection is an id and a name, never a user id or email", async () => {
    const world = await setup();
    const agg = present(await loadTripAggregate(world.db, TRIP_ID));
    agg.shareLink = { enabled: true, showsDeadlines: false };
    for (const requester of [linkVisitor, viewer]) {
      const view = projectTrip(agg, requester);
      for (const x of view.travelers) expect(Object.keys(x).sort()).toEqual(["id", "name"]);
      expect(JSON.stringify(view)).not.toContain("example.com");
    }
  });

  it("settings carry account names for members only and no emails", async () => {
    const world = await setup();
    const settings = await getTravelerSettings(world.ctx, TRIP_ID, kenny);
    expect(JSON.stringify(settings)).not.toContain("example.com");
    expect(JSON.stringify(settings)).not.toContain(USERS.jacob.id);
  });
});
