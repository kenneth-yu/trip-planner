import { and, asc, eq, sql } from "drizzle-orm";
import * as t from "../db/schema";
import { insertActivity } from "../repo/activity-repo";
import { loadTripAggregate, touchTrip, type DbOrTx } from "../repo/trip-repo";
import type { ServiceContext } from "./context";
import { NotFound } from "./trip-service";
import { InputProblem } from "@/domain/import/quick-add";
import { duplicateMessage, relationOf, sameName, TravelerNameInput, TripNameInput, type TravelerRelation } from "@/domain/travelers/names";
import type { BlockingItem } from "@/domain/travelers/removal";
import { AccessDenied, permissionsFor, projectTrip } from "@/domain/visibility/project";
import type { Requester, TripAggregate } from "@/domain/types";

const PICK_FROM_LIST = "Pick someone from the list.";

export interface TravelerRow {
  id: string;
  name: string;
  relation: TravelerRelation;
  removable: boolean;
}

export interface TravelerSettings {
  tripName: string;
  canRename: boolean;
  travelers: TravelerRow[];
  linkable: { userId: string; name: string }[];
}

export type RemoveOutcome =
  | { status: "removed"; name: string }
  | { status: "gone" }
  | { status: "refused"; name: string; visible: BlockingItem[] };

interface Editor {
  agg: TripAggregate;
  userId: string;
  isOwner: boolean;
}

async function requireEditor(db: DbOrTx, tripId: string, requester: Requester): Promise<Editor> {
  const agg = await loadTripAggregate(db, tripId);
  if (!agg || requester.kind !== "member") throw new NotFound();
  const member = agg.memberships.find((m) => m.userId === requester.userId);
  if (!member || member.role === "viewer") throw new NotFound();
  return { agg, userId: requester.userId, isOwner: permissionsFor(agg, requester).canManageSharing };
}

async function lockTravelers(tx: DbOrTx, tripId: string): Promise<void> {
  await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`travelers:${tripId}`}))`);
}

async function memberNames(db: DbOrTx, tripId: string): Promise<{ userId: string; name: string }[]> {
  return db
    .select({ userId: t.users.id, name: t.users.name })
    .from(t.memberships)
    .innerJoin(t.users, eq(t.users.id, t.memberships.userId))
    .where(eq(t.memberships.tripId, tripId))
    .orderBy(asc(t.users.name));
}

export async function getTravelerSettings(ctx: ServiceContext, tripId: string, requester: Requester): Promise<TravelerSettings> {
  const { agg, userId, isOwner } = await requireEditor(ctx.db, tripId, requester);
  const members = await memberNames(ctx.db, tripId);
  const linked = new Set(agg.travelers.flatMap((x) => (x.userId ? [x.userId] : [])));
  return {
    tripName: agg.trip.name,
    canRename: isOwner,
    travelers: agg.travelers.map((x) => ({ id: x.id, name: x.name, relation: relationOf(x, members, userId), removable: x.userId !== userId })),
    linkable: members.filter((m) => !linked.has(m.userId)),
  };
}

export async function renameTrip(ctx: ServiceContext, tripId: string, requester: Requester, input: unknown): Promise<{ name: string }> {
  const { agg, userId, isOwner } = await requireEditor(ctx.db, tripId, requester);
  if (!isOwner) throw new AccessDenied("Only the trip owner can do that.");
  const parsed = TripNameInput.safeParse(input);
  if (!parsed.success) throw new InputProblem(parsed.error.issues[0]?.message ?? "Give the trip a name.");
  await ctx.db.transaction(async (tx) => {
    await tx.update(t.trips).set({ name: parsed.data }).where(eq(t.trips.id, tripId));
    await touchTrip(tx, tripId);
    await insertActivity(tx, { tripId, actorId: userId, action: "trip_renamed", before: { name: agg.trip.name }, after: { name: parsed.data } });
  });
  await ctx.onTripChanged(tripId);
  return { name: parsed.data };
}

function parseName(input: unknown): string {
  const parsed = TravelerNameInput.safeParse(input);
  if (!parsed.success) throw new InputProblem(parsed.error.issues[0]?.message ?? "Add a name.");
  return parsed.data;
}

export async function addTraveler(ctx: ServiceContext, tripId: string, requester: Requester, input: unknown): Promise<{ id: string; name: string }> {
  const name = parseName(input);
  await requireEditor(ctx.db, tripId, requester);
  const created = await ctx.db.transaction(async (tx) => {
    await lockTravelers(tx, tripId);
    const { agg } = await requireEditor(tx, tripId, requester);
    if (agg.travelers.some((x) => sameName(x.name, name))) throw new InputProblem(duplicateMessage(name));
    const id = ctx.newId();
    await tx.insert(t.travelers).values({ id, tripId, name, userId: null });
    await touchTrip(tx, tripId);
    return { id, name };
  });
  await ctx.onTripChanged(tripId);
  return created;
}

export async function renameTraveler(ctx: ServiceContext, tripId: string, requester: Requester, travelerId: string, input: unknown): Promise<void> {
  const name = parseName(input);
  await requireEditor(ctx.db, tripId, requester);
  await ctx.db.transaction(async (tx) => {
    await lockTravelers(tx, tripId);
    const { agg } = await requireEditor(tx, tripId, requester);
    if (!agg.travelers.some((x) => x.id === travelerId)) throw new NotFound();
    if (agg.travelers.some((x) => x.id !== travelerId && sameName(x.name, name))) throw new InputProblem(duplicateMessage(name));
    await tx.update(t.travelers).set({ name }).where(and(eq(t.travelers.id, travelerId), eq(t.travelers.tripId, tripId)));
    await touchTrip(tx, tripId);
  });
  await ctx.onTripChanged(tripId);
}

export async function linkTraveler(ctx: ServiceContext, tripId: string, requester: Requester, travelerId: string, targetUserId: string): Promise<void> {
  await requireEditor(ctx.db, tripId, requester);
  await ctx.db.transaction(async (tx) => {
    await lockTravelers(tx, tripId);
    const { agg } = await requireEditor(tx, tripId, requester);
    const traveler = agg.travelers.find((x) => x.id === travelerId);
    if (!traveler) throw new NotFound();
    const isMember = agg.memberships.some((m) => m.userId === targetUserId);
    const taken = agg.travelers.some((x) => x.userId === targetUserId);
    if (traveler.userId !== null || !isMember || taken) throw new InputProblem(PICK_FROM_LIST);
    const linked = await tx
      .update(t.travelers)
      .set({ userId: targetUserId })
      .where(and(eq(t.travelers.id, travelerId), eq(t.travelers.tripId, tripId), sql`${t.travelers.userId} is null`))
      .returning({ id: t.travelers.id });
    if (linked.length === 0) throw new InputProblem(PICK_FROM_LIST);
    await touchTrip(tx, tripId);
  });
  await ctx.onTripChanged(tripId);
}

export async function removeTraveler(ctx: ServiceContext, tripId: string, requester: Requester, travelerId: string): Promise<RemoveOutcome> {
  await requireEditor(ctx.db, tripId, requester);
  const outcome = await ctx.db.transaction(async (tx): Promise<RemoveOutcome> => {
    await lockTravelers(tx, tripId);
    const locked = await tx
      .select({ id: t.travelers.id })
      .from(t.travelers)
      .where(and(eq(t.travelers.id, travelerId), eq(t.travelers.tripId, tripId)))
      .for("update");
    if (locked.length === 0) return { status: "gone" };
    const { agg, userId } = await requireEditor(tx, tripId, requester);
    const traveler = agg.travelers.find((x) => x.id === travelerId);
    if (!traveler) return { status: "gone" };
    if (traveler.userId === userId) throw new InputProblem("You cannot take yourself off the travelers.");
    const blocking = agg.items.filter((i) => i.travelerIds.includes(travelerId) || i.private.some((p) => p.travelerId === travelerId));
    if (blocking.length > 0) {
      const seen = new Set(projectTrip(agg, requester).items.map((i) => i.id));
      const visible = blocking
        .filter((i) => seen.has(i.id))
        .map((i): BlockingItem => ({
          id: i.id,
          title: i.title,
          flightNumber: i.flight?.flightNumber ?? null,
          hasSeat: i.private.some((p) => p.travelerId === travelerId && Boolean(p.seat)),
        }));
      return { status: "refused", name: traveler.name, visible };
    }
    await tx.delete(t.travelers).where(and(eq(t.travelers.id, travelerId), eq(t.travelers.tripId, tripId)));
    await touchTrip(tx, tripId);
    return { status: "removed", name: traveler.name };
  });
  if (outcome.status === "removed") await ctx.onTripChanged(tripId);
  return outcome;
}
