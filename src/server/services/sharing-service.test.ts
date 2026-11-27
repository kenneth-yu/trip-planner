import { describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { TRAVELERS, TRIP_ID, USERS } from "@/fixtures/december-trip";
import { AccessDenied, projectTrip } from "@/domain/visibility/project";
import { InvalidTransition } from "@/domain/state/machine";
import type { Requester } from "@/domain/types";
import { present } from "@/testing/present";
import * as t from "../db/schema";
import { hashToken } from "../auth/tokens";
import { loadTripAggregate } from "../repo/trip-repo";
import { jacob, kenny, testContext } from "../testing";
import { InputProblem } from "@/domain/import/quick-add";
import { NotFound } from "./trip-service";
import {
  acceptInvite,
  changeRole,
  createInvite,
  hiddenItemCount,
  InviteProblem,
  invitePreview,
  listInvites,
  listMembers,
  removeMember,
  revokeInvite,
} from "./sharing-service";

const DAY_MS = 24 * 60 * 60 * 1000;
const newcomer = { id: "00000000-0000-4000-8100-000000000a01", name: "Mina Okafor" };
const second = { id: "00000000-0000-4000-8100-000000000a02", name: "Sam Lee" };
const newcomerRequester: Requester = { kind: "member", userId: newcomer.id, homeZone: "America/New_York" };

async function setup(opts: { jacobUnlinked?: boolean } = {}) {
  const world = await testContext();
  await world.db.insert(t.users).values([
    { id: newcomer.id, name: newcomer.name, email: "mina@example.com" },
    { id: second.id, name: second.name, email: "sam@example.com" },
  ]);
  if (opts.jacobUnlinked) {
    await world.db.delete(t.memberships).where(eq(t.memberships.userId, USERS.jacob.id));
    await world.db.update(t.travelers).set({ userId: null }).where(eq(t.travelers.id, TRAVELERS.jacob));
  }
  return world;
}

function tokenOf(url: string): string {
  return present(url.split("/invite/")[1]);
}

function laterBy(ctx: Awaited<ReturnType<typeof setup>>["ctx"], ms: number) {
  return { ...ctx, now: () => new Date(ctx.now().getTime() + ms) };
}

describe("creating invites", () => {
  it("makes a link on the app url, stores only its hash and expires in 7 days", async () => {
    const { ctx, db } = await setup();
    const { inviteId, url } = await createInvite(ctx, TRIP_ID, kenny, { role: "editor" });
    expect(url.startsWith("https://trips.test/invite/")).toBe(true);
    const token = tokenOf(url);
    const [row] = await db.select().from(t.invites).where(eq(t.invites.id, inviteId));
    const stored = present(row);
    expect(stored.tokenHash).toBe(hashToken(token));
    expect(JSON.stringify(stored)).not.toContain(token);
    expect(stored.role).toBe("editor");
    expect(stored.createdBy).toBe(USERS.kenny.id);
    expect(stored.expiresAt.getTime() - ctx.now().getTime()).toBe(7 * DAY_MS);
    expect(Buffer.from(token.replace(/^tpi_/, ""), "base64url").length).toBe(32);
  });

  it("makes a different link every time", async () => {
    const { ctx } = await setup();
    const a = await createInvite(ctx, TRIP_ID, kenny, { role: "viewer" });
    const b = await createInvite(ctx, TRIP_ID, kenny, { role: "viewer" });
    expect(a.url).not.toBe(b.url);
  });

  it("lets only the owner invite", async () => {
    const { ctx } = await setup();
    await expect(createInvite(ctx, TRIP_ID, jacob, { role: "editor" })).rejects.toThrow(AccessDenied);
    await expect(createInvite(ctx, TRIP_ID, { kind: "link", homeZone: "UTC" }, { role: "viewer" })).rejects.toThrow(AccessDenied);
    await expect(createInvite(ctx, TRIP_ID, newcomerRequester, { role: "viewer" })).rejects.toThrow(AccessDenied);
  });

  it("refuses an owner role and a malformed traveler id", async () => {
    const { ctx } = await setup();
    await expect(createInvite(ctx, TRIP_ID, kenny, { role: "owner" })).rejects.toThrow(InputProblem);
    await expect(createInvite(ctx, TRIP_ID, kenny, { role: "editor", travelerId: "nope" })).rejects.toThrow(InputProblem);
  });

  it("refuses a traveler from another trip and a traveler already linked to a person", async () => {
    const { ctx, db } = await setup();
    const otherTrip = "00000000-0000-4000-8300-0000000000aa";
    const strangerTraveler = "00000000-0000-4000-8200-0000000000aa";
    await db.insert(t.trips).values({ id: otherTrip, name: "Other", ownerId: USERS.kenny.id });
    await db.insert(t.travelers).values({ id: strangerTraveler, tripId: otherTrip, name: "Jacob" });
    await expect(createInvite(ctx, TRIP_ID, kenny, { role: "editor", travelerId: strangerTraveler })).rejects.toThrow(InputProblem);
    await expect(createInvite(ctx, TRIP_ID, kenny, { role: "editor", travelerId: TRAVELERS.jacob })).rejects.toThrow(InputProblem);
  });
});

describe("accepting invites", () => {
  it("adds the person with the chosen role and links the chosen traveler without creating another", async () => {
    const { ctx, db } = await setup({ jacobUnlinked: true });
    const { url } = await createInvite(ctx, TRIP_ID, kenny, { role: "editor", travelerId: TRAVELERS.jacob });
    const result = await acceptInvite(ctx, tokenOf(url), newcomer);
    expect(result).toEqual({ tripId: TRIP_ID, role: "editor", alreadyMember: false, invitedRole: "editor" });
    const agg = present(await loadTripAggregate(db, TRIP_ID));
    expect(agg.memberships.find((m) => m.userId === newcomer.id)?.role).toBe("editor");
    expect(agg.travelers).toHaveLength(2);
    expect(agg.travelers.find((x) => x.id === TRAVELERS.jacob)?.userId).toBe(newcomer.id);
    const nh159 = present(agg.items.find((i) => i.flight?.flightNumber === "NH159"));
    expect(nh159.travelerIds).toContain(TRAVELERS.jacob);
    const view = projectTrip(agg, newcomerRequester);
    expect(view.permissions.canEdit).toBe(true);
    expect(present(view.items.find((i) => i.flight?.flightNumber === "NH159")).private.length).toBeGreaterThan(0);
  });

  it("creates exactly one traveler named from the person when no traveler was chosen", async () => {
    const { ctx, db } = await setup();
    const { url } = await createInvite(ctx, TRIP_ID, kenny, { role: "viewer" });
    await acceptInvite(ctx, tokenOf(url), newcomer);
    const travelers = await db.select().from(t.travelers).where(eq(t.travelers.tripId, TRIP_ID));
    expect(travelers).toHaveLength(3);
    expect(travelers.filter((x) => x.userId === newcomer.id).map((x) => x.name)).toEqual([newcomer.name]);
  });

  it("makes a new traveler when the chosen one was linked in the meantime", async () => {
    const { ctx, db } = await setup({ jacobUnlinked: true });
    const { url } = await createInvite(ctx, TRIP_ID, kenny, { role: "editor", travelerId: TRAVELERS.jacob });
    await db.update(t.travelers).set({ userId: second.id }).where(eq(t.travelers.id, TRAVELERS.jacob));
    await acceptInvite(ctx, tokenOf(url), newcomer);
    const travelers = await db.select().from(t.travelers).where(eq(t.travelers.tripId, TRIP_ID));
    expect(travelers.find((x) => x.id === TRAVELERS.jacob)?.userId).toBe(second.id);
    expect(travelers.filter((x) => x.userId === newcomer.id)).toHaveLength(1);
  });

  it("shows a viewer no booking codes", async () => {
    const { ctx, db } = await setup();
    const { url } = await createInvite(ctx, TRIP_ID, kenny, { role: "viewer" });
    await acceptInvite(ctx, tokenOf(url), newcomer);
    const view = projectTrip(present(await loadTripAggregate(db, TRIP_ID)), newcomerRequester);
    expect(view.permissions.canEdit).toBe(false);
    expect(view.items.every((i) => i.private.length === 0)).toBe(true);
    expect(JSON.stringify(view)).not.toContain("PLACEHOLDER");
  });

  it("works once", async () => {
    const { ctx, db } = await setup();
    const { url } = await createInvite(ctx, TRIP_ID, kenny, { role: "viewer" });
    await acceptInvite(ctx, tokenOf(url), newcomer);
    await expect(acceptInvite(ctx, tokenOf(url), second)).rejects.toMatchObject({ problem: "unusable" });
    const [row] = await db.select().from(t.invites);
    expect(present(row).acceptedBy).toBe(newcomer.id);
  });

  it("lets exactly one of two simultaneous acceptances win", async () => {
    const { ctx, db } = await setup();
    const { url } = await createInvite(ctx, TRIP_ID, kenny, { role: "editor" });
    const results = await Promise.allSettled([acceptInvite(ctx, tokenOf(url), newcomer), acceptInvite(ctx, tokenOf(url), second)]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const lost = results.find((r) => r.status === "rejected");
    expect(lost?.status === "rejected" && lost.reason).toBeInstanceOf(InviteProblem);
    expect(await db.select().from(t.memberships).where(eq(t.memberships.tripId, TRIP_ID))).toHaveLength(3);
    expect(await db.select().from(t.travelers).where(eq(t.travelers.tripId, TRIP_ID))).toHaveLength(3);
  });

  it("rejects an expired link and adds nobody", async () => {
    const { ctx, db } = await setup();
    const { url } = await createInvite(ctx, TRIP_ID, kenny, { role: "editor" });
    await expect(acceptInvite(laterBy(ctx, 7 * DAY_MS), tokenOf(url), newcomer)).rejects.toMatchObject({ problem: "expired" });
    expect(await db.select().from(t.memberships).where(eq(t.memberships.userId, newcomer.id))).toEqual([]);
  });

  it("accepts a link just before it expires", async () => {
    const { ctx } = await setup();
    const { url } = await createInvite(ctx, TRIP_ID, kenny, { role: "editor" });
    await expect(acceptInvite(laterBy(ctx, 7 * DAY_MS - 1000), tokenOf(url), newcomer)).resolves.toMatchObject({ alreadyMember: false });
  });

  it("rejects a revoked link", async () => {
    const { ctx } = await setup();
    const { inviteId, url } = await createInvite(ctx, TRIP_ID, kenny, { role: "editor" });
    await revokeInvite(ctx, TRIP_ID, kenny, inviteId);
    await expect(acceptInvite(ctx, tokenOf(url), newcomer)).rejects.toMatchObject({ problem: "unusable" });
  });

  it("rejects a token that was never issued", async () => {
    const { ctx } = await setup();
    await expect(acceptInvite(ctx, "tpi_nothing", newcomer)).rejects.toMatchObject({ problem: "unusable" });
    await expect(acceptInvite(ctx, "", newcomer)).rejects.toMatchObject({ problem: "unusable" });
  });

  it("leaves an existing viewer a viewer and the editor link unused", async () => {
    const { ctx, db } = await setup();
    await db.update(t.memberships).set({ role: "viewer" }).where(eq(t.memberships.userId, USERS.jacob.id));
    const { inviteId, url } = await createInvite(ctx, TRIP_ID, kenny, { role: "editor" });
    const result = await acceptInvite(ctx, tokenOf(url), { id: USERS.jacob.id, name: USERS.jacob.name });
    expect(result).toEqual({ tripId: TRIP_ID, role: "viewer", alreadyMember: true, invitedRole: "editor" });
    const [row] = await db.select().from(t.invites).where(eq(t.invites.id, inviteId));
    expect(present(row).acceptedAt).toBeNull();
    const [m] = await db.select().from(t.memberships).where(and(eq(t.memberships.tripId, TRIP_ID), eq(t.memberships.userId, USERS.jacob.id)));
    expect(present(m).role).toBe("viewer");
    expect(await db.select().from(t.travelers).where(eq(t.travelers.tripId, TRIP_ID))).toHaveLength(2);
    await expect(acceptInvite(ctx, tokenOf(url), newcomer)).resolves.toMatchObject({ role: "editor", alreadyMember: false });
  });

  it("never demotes the owner who opens a viewer link", async () => {
    const { ctx, db } = await setup();
    const { url } = await createInvite(ctx, TRIP_ID, kenny, { role: "viewer" });
    const result = await acceptInvite(ctx, tokenOf(url), { id: USERS.kenny.id, name: USERS.kenny.name });
    expect(result.role).toBe("owner");
    const [m] = await db.select().from(t.memberships).where(and(eq(t.memberships.tripId, TRIP_ID), eq(t.memberships.userId, USERS.kenny.id)));
    expect(present(m).role).toBe("owner");
  });
});

describe("previewing an invite before sign in", () => {
  it("gives the trip name, the inviter first name and the role of a live link", async () => {
    const { ctx, db } = await setup();
    const { url } = await createInvite(ctx, TRIP_ID, kenny, { role: "viewer" });
    const [trip] = await db.select().from(t.trips).where(eq(t.trips.id, TRIP_ID));
    expect(await invitePreview(ctx, tokenOf(url))).toEqual({ tripName: present(trip).name, inviterFirstName: "Kenneth", role: "viewer" });
  });

  it("says only expired or unusable for dead links", async () => {
    const { ctx } = await setup();
    const { inviteId, url } = await createInvite(ctx, TRIP_ID, kenny, { role: "viewer" });
    expect(await invitePreview(laterBy(ctx, 8 * DAY_MS), tokenOf(url))).toEqual({ problem: "expired" });
    await revokeInvite(ctx, TRIP_ID, kenny, inviteId);
    expect(await invitePreview(ctx, tokenOf(url))).toEqual({ problem: "unusable" });
    expect(await invitePreview(ctx, "tpi_unknown")).toEqual({ problem: "unusable" });
  });

  it("does not use up the link", async () => {
    const { ctx, db } = await setup();
    const { url } = await createInvite(ctx, TRIP_ID, kenny, { role: "viewer" });
    await invitePreview(ctx, tokenOf(url));
    const [row] = await db.select().from(t.invites);
    expect(present(row).acceptedAt).toBeNull();
  });
});

describe("pending invites", () => {
  it("lists them without the token, with the traveler when there is one", async () => {
    const { ctx } = await setup({ jacobUnlinked: true });
    const withTraveler = await createInvite(ctx, TRIP_ID, kenny, { role: "editor", travelerId: TRAVELERS.jacob });
    await createInvite(ctx, TRIP_ID, kenny, { role: "viewer" });
    const list = await listInvites(ctx, TRIP_ID, kenny);
    expect(list).toHaveLength(2);
    expect(list.find((i) => i.id === withTraveler.inviteId)).toMatchObject({ role: "editor", travelerName: USERS.jacob.name });
    expect(list.find((i) => i.role === "viewer")?.travelerName).toBeNull();
    const text = JSON.stringify(list);
    expect(text).not.toContain(tokenOf(withTraveler.url));
    expect(text).not.toContain(hashToken(tokenOf(withTraveler.url)));
  });

  it("drops accepted, revoked and expired invites from the list", async () => {
    const { ctx } = await setup();
    const accepted = await createInvite(ctx, TRIP_ID, kenny, { role: "viewer" });
    const revoked = await createInvite(ctx, TRIP_ID, kenny, { role: "viewer" });
    await createInvite(ctx, TRIP_ID, kenny, { role: "editor" });
    await acceptInvite(ctx, tokenOf(accepted.url), newcomer);
    await revokeInvite(ctx, TRIP_ID, kenny, revoked.inviteId);
    expect(await listInvites(ctx, TRIP_ID, kenny)).toHaveLength(1);
    expect(await listInvites(laterBy(ctx, 8 * DAY_MS), TRIP_ID, kenny)).toEqual([]);
  });

  it("is for the owner only", async () => {
    const { ctx } = await setup();
    await expect(listInvites(ctx, TRIP_ID, jacob)).rejects.toThrow(AccessDenied);
  });

  it("revokes only for the owner, once, and only on its own trip", async () => {
    const { ctx, db } = await setup();
    const { inviteId } = await createInvite(ctx, TRIP_ID, kenny, { role: "editor" });
    await expect(revokeInvite(ctx, TRIP_ID, jacob, inviteId)).rejects.toThrow(AccessDenied);
    const otherTrip = "00000000-0000-4000-8300-0000000000aa";
    await db.insert(t.trips).values({ id: otherTrip, name: "Other", ownerId: newcomer.id });
    await db.insert(t.memberships).values({ tripId: otherTrip, userId: newcomer.id, role: "owner" });
    await expect(revokeInvite(ctx, otherTrip, newcomerRequester, inviteId)).rejects.toThrow(NotFound);
    await revokeInvite(ctx, TRIP_ID, kenny, inviteId);
    await expect(revokeInvite(ctx, TRIP_ID, kenny, inviteId)).rejects.toThrow(InvalidTransition);
  });
});

describe("members", () => {
  it("lists names and roles and marks the requester", async () => {
    const { ctx } = await setup();
    expect(await listMembers(ctx, TRIP_ID, jacob)).toEqual([
      { userId: USERS.jacob.id, name: USERS.jacob.name, role: "editor", isYou: true },
      { userId: USERS.kenny.id, name: USERS.kenny.name, role: "owner", isYou: false },
    ]);
  });

  it("refuses people who are not on the trip", async () => {
    const { ctx } = await setup();
    await expect(listMembers(ctx, TRIP_ID, newcomerRequester)).rejects.toThrow(AccessDenied);
  });

  it("changes a role for the owner only and the new role takes effect", async () => {
    const { ctx, db, changed } = await setup();
    await expect(changeRole(ctx, TRIP_ID, jacob, USERS.jacob.id, "viewer")).rejects.toThrow(AccessDenied);
    await changeRole(ctx, TRIP_ID, kenny, USERS.jacob.id, "viewer");
    const view = projectTrip(present(await loadTripAggregate(db, TRIP_ID)), jacob);
    expect(view.permissions.canEdit).toBe(false);
    expect(view.items.every((i) => i.private.length === 0)).toBe(true);
    expect(changed).toContain(TRIP_ID);
  });

  it("never demotes the owner, and refuses an owner role or a person not on the trip", async () => {
    const { ctx } = await setup();
    await expect(changeRole(ctx, TRIP_ID, kenny, USERS.kenny.id, "viewer")).rejects.toThrow(AccessDenied);
    await expect(changeRole(ctx, TRIP_ID, kenny, newcomer.id, "viewer")).rejects.toThrow(NotFound);
    await expect(changeRole(ctx, TRIP_ID, kenny, USERS.jacob.id, "owner")).rejects.toThrow(InputProblem);
  });
});

describe("removing a member", () => {
  async function jacobWithHiddenItems() {
    const world = await setup();
    const agg = present(await loadTripAggregate(world.db, TRIP_ID));
    const [onlyMe, specific, shared] = agg.items.map((i) => i.id);
    await world.db.update(t.items).set({ createdBy: USERS.jacob.id, visibility: "only_me" }).where(eq(t.items.id, present(onlyMe)));
    await world.db
      .update(t.items)
      .set({ createdBy: USERS.jacob.id, visibility: "specific", visibleToUserIds: [USERS.kenny.id] })
      .where(eq(t.items.id, present(specific)));
    await world.db.update(t.items).set({ createdBy: USERS.jacob.id }).where(eq(t.items.id, present(shared)));
    await world.db.insert(t.activity).values({ tripId: TRIP_ID, actorId: USERS.jacob.id, action: "created", itemId: present(onlyMe) });
    return { ...world, onlyMe: present(onlyMe), specific: present(specific), shared: present(shared) };
  }

  it("counts the hidden items the person made, for the confirmation", async () => {
    const { ctx } = await jacobWithHiddenItems();
    expect(await hiddenItemCount(ctx, TRIP_ID, kenny, USERS.jacob.id)).toBe(2);
    expect(await hiddenItemCount(ctx, TRIP_ID, kenny, USERS.kenny.id)).toBe(0);
    await expect(hiddenItemCount(ctx, TRIP_ID, jacob, USERS.jacob.id)).rejects.toThrow(AccessDenied);
  });

  it("removes access, their hidden items and their traveler link, and keeps shared items", async () => {
    const { ctx, db, onlyMe, specific, shared, changed } = await jacobWithHiddenItems();
    expect(await removeMember(ctx, TRIP_ID, kenny, USERS.jacob.id)).toEqual({ removedHiddenItems: 2 });
    const agg = present(await loadTripAggregate(db, TRIP_ID));
    expect(agg.memberships.map((m) => m.userId)).toEqual([USERS.kenny.id]);
    expect(agg.travelers.find((x) => x.id === TRAVELERS.jacob)?.userId).toBeNull();
    const kept = agg.items.map((i) => i.id);
    expect(kept).not.toContain(onlyMe);
    expect(kept).not.toContain(specific);
    expect(kept).toContain(shared);
    expect(await db.select().from(t.activity).where(eq(t.activity.itemId, onlyMe))).toEqual([]);
    expect(changed).toContain(TRIP_ID);
    expect(() => projectTrip(agg, jacob)).toThrow(AccessDenied);
  });

  it("takes the person off other people's specific item lists", async () => {
    const { ctx, db } = await setup();
    const agg = present(await loadTripAggregate(db, TRIP_ID));
    const target = present(agg.items[0]);
    await db
      .update(t.items)
      .set({ visibility: "specific", visibleToUserIds: [USERS.jacob.id, USERS.kenny.id] })
      .where(eq(t.items.id, target.id));
    await removeMember(ctx, TRIP_ID, kenny, USERS.jacob.id);
    const after = present(await loadTripAggregate(db, TRIP_ID));
    expect(present(after.items.find((i) => i.id === target.id)).visibleToUserIds).toEqual([USERS.kenny.id]);
  });

  it("is for the owner only and never removes the owner", async () => {
    const { ctx } = await setup();
    await expect(removeMember(ctx, TRIP_ID, jacob, USERS.kenny.id)).rejects.toThrow(AccessDenied);
    await expect(removeMember(ctx, TRIP_ID, kenny, USERS.kenny.id)).rejects.toThrow(AccessDenied);
    await expect(removeMember(ctx, TRIP_ID, kenny, newcomer.id)).rejects.toThrow(NotFound);
  });

  it("lets the removed person come back only with a new link", async () => {
    const { ctx } = await setup();
    const old = await createInvite(ctx, TRIP_ID, kenny, { role: "editor" });
    await acceptInvite(ctx, tokenOf(old.url), newcomer);
    await removeMember(ctx, TRIP_ID, kenny, newcomer.id);
    await expect(acceptInvite(ctx, tokenOf(old.url), newcomer)).rejects.toThrow(InviteProblem);
    const fresh = await createInvite(ctx, TRIP_ID, kenny, { role: "viewer" });
    await expect(acceptInvite(ctx, tokenOf(fresh.url), newcomer)).resolves.toMatchObject({ role: "viewer", alreadyMember: false });
  });
});
