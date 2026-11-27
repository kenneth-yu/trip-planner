import { and, desc, eq, inArray, isNull, ne, sql } from "drizzle-orm";
import { z } from "zod";
import * as t from "../db/schema";
import { generateToken, hashToken } from "../auth/tokens";
import type { DbOrTx } from "../repo/trip-repo";
import type { ServiceContext } from "./context";
import { listTripMembers } from "./member-service";
import { NotFound, requireAggregate } from "./trip-service";
import { InputProblem } from "@/domain/import/quick-add";
import { machine as inviteMachine, type InviteState } from "@/domain/state/invite.machine";
import { transition } from "@/domain/state/machine";
import { AccessDenied, permissionsFor } from "@/domain/visibility/project";
import type { Requester, Role, TripAggregate } from "@/domain/types";

export const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export type InviteRole = "editor" | "viewer";

export class InviteProblem extends Error {
  constructor(readonly problem: "expired" | "unusable") {
    super(problem === "expired" ? "That link has expired. Ask the trip owner for a new one." : "That link no longer works. Ask the trip owner for a new one.");
    this.name = "InviteProblem";
  }
}

const CreateInput = z.object({ role: z.enum(["editor", "viewer"]), travelerId: z.string().uuid().optional() });
const RoleInput = z.enum(["editor", "viewer"]);

function inviteState(row: { acceptedAt: Date | null; revokedAt: Date | null; expiresAt: Date }, now: Date): InviteState {
  if (row.acceptedAt) return "Accepted";
  if (row.revokedAt) return "Revoked";
  if (row.expiresAt.getTime() <= now.getTime()) return "Expired";
  return "Pending";
}

function problemFor(state: InviteState): InviteProblem {
  return new InviteProblem(state === "Expired" ? "expired" : "unusable");
}

async function requireOwner(db: DbOrTx, tripId: string, requester: Requester): Promise<TripAggregate> {
  const agg = await requireAggregate(db, tripId);
  if (!permissionsFor(agg, requester).canManageSharing || requester.kind !== "member") throw new AccessDenied("Only the trip owner can do that.");
  return agg;
}

async function inviteByToken(db: DbOrTx, token: string) {
  if (!token) return null;
  const [row] = await db.select().from(t.invites).where(eq(t.invites.tokenHash, hashToken(token)));
  return row ?? null;
}

export async function createInvite(
  ctx: ServiceContext,
  tripId: string,
  requester: Requester,
  input: unknown,
): Promise<{ inviteId: string; url: string }> {
  const parsed = CreateInput.safeParse(input);
  if (!parsed.success) throw new InputProblem("Pick editor or viewer, and pick someone from the list.");
  const agg = await requireOwner(ctx.db, tripId, requester);
  const { role, travelerId } = parsed.data;
  if (travelerId) {
    const traveler = agg.travelers.find((x) => x.id === travelerId);
    if (!traveler || traveler.userId !== null) throw new InputProblem("Pick someone from the list.");
  }
  if (requester.kind !== "member") throw new AccessDenied();
  const token = generateToken("tpi");
  const inviteId = ctx.newId();
  await ctx.db.insert(t.invites).values({
    id: inviteId,
    tripId,
    role,
    travelerId: travelerId ?? null,
    tokenHash: hashToken(token),
    createdBy: requester.userId,
    expiresAt: new Date(ctx.now().getTime() + INVITE_TTL_MS),
  });
  return { inviteId, url: `${ctx.appUrl}/invite/${token}` };
}

export interface AcceptedInvite {
  tripId: string;
  role: Role;
  alreadyMember: boolean;
  invitedRole: InviteRole;
}

async function membershipOf(db: DbOrTx, tripId: string, userId: string): Promise<Role | null> {
  const [row] = await db
    .select({ role: t.memberships.role })
    .from(t.memberships)
    .where(and(eq(t.memberships.tripId, tripId), eq(t.memberships.userId, userId)));
  return row?.role ?? null;
}

async function alreadyClaimedBy(db: DbOrTx, invite: typeof t.invites.$inferSelect, userId: string): Promise<AcceptedInvite | null> {
  if (invite.acceptedBy !== userId) return null;
  const role = await membershipOf(db, invite.tripId, userId);
  return role ? { tripId: invite.tripId, role, alreadyMember: true, invitedRole: invite.role } : null;
}

export async function acceptInvite(ctx: ServiceContext, token: string, user: { id: string; name: string }): Promise<AcceptedInvite> {
  return ctx.db.transaction(async (tx) => {
    const invite = await inviteByToken(tx, token);
    if (!invite) throw new InviteProblem("unusable");
    const now = ctx.now();
    const state = inviteState(invite, now);
    if (state !== "Pending") {
      const own = await alreadyClaimedBy(tx, invite, user.id);
      if (own) return own;
      throw problemFor(state);
    }
    const existing = await membershipOf(tx, invite.tripId, user.id);
    if (existing) return { tripId: invite.tripId, role: existing, alreadyMember: true, invitedRole: invite.role };
    transition(inviteMachine, state, "accept");
    const claimed = await tx
      .update(t.invites)
      .set({ acceptedAt: now, acceptedBy: user.id })
      .where(and(eq(t.invites.id, invite.id), isNull(t.invites.acceptedAt), isNull(t.invites.revokedAt), sql`${t.invites.expiresAt} > ${now}`))
      .returning({ id: t.invites.id });
    if (claimed.length === 0) {
      const [latest] = await tx.select().from(t.invites).where(eq(t.invites.id, invite.id));
      const own = latest ? await alreadyClaimedBy(tx, latest, user.id) : null;
      if (own) return own;
      throw new InviteProblem("unusable");
    }
    await tx.insert(t.memberships).values({ tripId: invite.tripId, userId: user.id, role: invite.role });
    const linked = invite.travelerId
      ? await tx
          .update(t.travelers)
          .set({ userId: user.id })
          .where(and(eq(t.travelers.id, invite.travelerId), eq(t.travelers.tripId, invite.tripId), isNull(t.travelers.userId)))
          .returning({ id: t.travelers.id })
      : [];
    if (linked.length === 0) await tx.insert(t.travelers).values({ id: ctx.newId(), tripId: invite.tripId, name: user.name, userId: user.id });
    return { tripId: invite.tripId, role: invite.role, alreadyMember: false, invitedRole: invite.role };
  });
}

const UNNAMED_INVITER = "A trip member";

function displayFirstName(name: string, email: string): string {
  const local = email.split("@")[0]?.toLowerCase();
  if (name.includes("@") || name.toLowerCase() === local) return UNNAMED_INVITER;
  return name.split(" ")[0] || UNNAMED_INVITER;
}

export type InvitePreview = { tripName: string; inviterFirstName: string; role: InviteRole } | { problem: "expired" | "unusable" };

export async function invitePreview(ctx: ServiceContext, token: string): Promise<InvitePreview> {
  const invite = await inviteByToken(ctx.db, token);
  if (!invite) return { problem: "unusable" };
  const state = inviteState(invite, ctx.now());
  if (state !== "Pending") return { problem: state === "Expired" ? "expired" : "unusable" };
  const [row] = await ctx.db
    .select({ tripName: t.trips.name, inviter: t.users.name, inviterEmail: t.users.email })
    .from(t.trips)
    .innerJoin(t.users, eq(t.users.id, invite.createdBy))
    .where(eq(t.trips.id, invite.tripId));
  if (!row) return { problem: "unusable" };
  return { tripName: row.tripName, inviterFirstName: displayFirstName(row.inviter, row.inviterEmail), role: invite.role };
}

export interface PendingInvite {
  id: string;
  role: InviteRole;
  travelerName: string | null;
  createdAt: Date;
  expiresAt: Date;
}

export async function listInvites(ctx: ServiceContext, tripId: string, requester: Requester): Promise<PendingInvite[]> {
  await requireOwner(ctx.db, tripId, requester);
  const rows = await ctx.db
    .select({
      id: t.invites.id,
      role: t.invites.role,
      travelerName: t.travelers.name,
      createdAt: t.invites.createdAt,
      expiresAt: t.invites.expiresAt,
      acceptedAt: t.invites.acceptedAt,
      revokedAt: t.invites.revokedAt,
    })
    .from(t.invites)
    .leftJoin(t.travelers, eq(t.travelers.id, t.invites.travelerId))
    .where(eq(t.invites.tripId, tripId))
    .orderBy(desc(t.invites.createdAt));
  const now = ctx.now();
  return rows.filter((r) => inviteState(r, now) === "Pending").map((r) => ({ id: r.id, role: r.role, travelerName: r.travelerName, createdAt: r.createdAt, expiresAt: r.expiresAt }));
}

export async function revokeInvite(ctx: ServiceContext, tripId: string, requester: Requester, inviteId: string): Promise<void> {
  await requireOwner(ctx.db, tripId, requester);
  const [row] = await ctx.db.select().from(t.invites).where(and(eq(t.invites.id, inviteId), eq(t.invites.tripId, tripId)));
  if (!row) throw new NotFound();
  transition(inviteMachine, inviteState(row, ctx.now()), "revoke");
  const revoked = await ctx.db
    .update(t.invites)
    .set({ revokedAt: ctx.now() })
    .where(and(eq(t.invites.id, inviteId), isNull(t.invites.acceptedAt), isNull(t.invites.revokedAt)))
    .returning({ id: t.invites.id });
  if (revoked.length === 0) throw new InviteProblem("unusable");
}

export interface Member {
  userId: string;
  name: string;
  role: Role;
  isYou: boolean;
}

export async function listMembers(ctx: ServiceContext, tripId: string, requester: Requester): Promise<Member[]> {
  const members = await listTripMembers(ctx, tripId, requester);
  return members.map((m) => ({ ...m, isYou: requester.kind === "member" && m.userId === requester.userId }));
}

export async function changeRole(ctx: ServiceContext, tripId: string, requester: Requester, userId: string, role: unknown): Promise<void> {
  const parsed = RoleInput.safeParse(role);
  if (!parsed.success) throw new InputProblem("Pick editor or viewer.");
  const agg = await requireOwner(ctx.db, tripId, requester);
  const target = agg.memberships.find((m) => m.userId === userId);
  if (!target) throw new NotFound();
  if (target.role === "owner") throw new AccessDenied("The owner's role cannot be changed.");
  await ctx.db
    .update(t.memberships)
    .set({ role: parsed.data })
    .where(and(eq(t.memberships.tripId, tripId), eq(t.memberships.userId, userId)));
  await ctx.onTripChanged(tripId);
}

async function requireRemovable(db: DbOrTx, tripId: string, requester: Requester, userId: string): Promise<TripAggregate> {
  const agg = await requireOwner(db, tripId, requester);
  const target = agg.memberships.find((m) => m.userId === userId);
  if (!target) throw new NotFound();
  if (target.role === "owner") throw new AccessDenied("The owner cannot be removed.");
  return agg;
}

export async function hiddenItemCount(ctx: ServiceContext, tripId: string, requester: Requester, userId: string): Promise<number> {
  await requireOwner(ctx.db, tripId, requester);
  const [row] = await ctx.db
    .select({ n: sql<number>`count(*)::int` })
    .from(t.items)
    .where(and(eq(t.items.tripId, tripId), eq(t.items.createdBy, userId), ne(t.items.visibility, "everyone")));
  return row?.n ?? 0;
}

export async function removeMember(ctx: ServiceContext, tripId: string, requester: Requester, userId: string): Promise<{ removedHiddenItems: number }> {
  const removed = await ctx.db.transaction(async (tx) => {
    const agg = await requireRemovable(tx, tripId, requester, userId);
    const hidden = await tx
      .delete(t.items)
      .where(and(eq(t.items.tripId, tripId), eq(t.items.createdBy, userId), ne(t.items.visibility, "everyone")))
      .returning({ id: t.items.id });
    const hiddenIds = hidden.map((h) => h.id);
    if (hiddenIds.length > 0) await tx.delete(t.activity).where(inArray(t.activity.itemId, hiddenIds));
    for (const item of agg.items.filter((i) => i.visibility === "specific" && i.visibleToUserIds.includes(userId) && !hiddenIds.includes(i.id))) {
      await tx
        .update(t.items)
        .set({ visibleToUserIds: item.visibleToUserIds.filter((id) => id !== userId) })
        .where(eq(t.items.id, item.id));
    }
    await tx.update(t.travelers).set({ userId: null }).where(and(eq(t.travelers.tripId, tripId), eq(t.travelers.userId, userId)));
    await tx.delete(t.memberships).where(and(eq(t.memberships.tripId, tripId), eq(t.memberships.userId, userId)));
    return hiddenIds.length;
  });
  await ctx.onTripChanged(tripId);
  return { removedHiddenItems: removed };
}

export async function listUnlinkedTravelers(ctx: ServiceContext, tripId: string, requester: Requester): Promise<{ id: string; name: string }[]> {
  const agg = await requireOwner(ctx.db, tripId, requester);
  return agg.travelers.filter((x) => x.userId === null).map((x) => ({ id: x.id, name: x.name }));
}
