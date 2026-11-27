import { and, asc, eq, inArray, ne, sql } from "drizzle-orm";
import type { AnyPgColumn, PgTable } from "drizzle-orm/pg-core";
import * as t from "../db/schema";
import type { ServiceContext } from "./context";
import { syncTripMirrors, teardownMirror } from "./mirror-service";
import { NotFound, requireAggregate } from "./trip-service";
import { AccessDenied, permissionsFor } from "@/domain/visibility/project";
import type { Requester } from "@/domain/types";

export const TRIP_DATA_TABLES: readonly (PgTable & { tripId: AnyPgColumn })[] = [
  t.calendarMirrors,
  t.importedItems,
  t.importBatches,
  t.activity,
  t.checkDismissals,
  t.assistantTokens,
  t.invites,
  t.shareLinks,
  t.items,
  t.travelers,
  t.memberships,
];

type Tx = Parameters<Parameters<ServiceContext["db"]["transaction"]>[0]>[0];

async function teardownTripMirrors(ctx: ServiceContext, tripId: string): Promise<void> {
  const mirrors = await ctx.db.select({ userId: t.calendarMirrors.userId }).from(t.calendarMirrors).where(eq(t.calendarMirrors.tripId, tripId));
  for (const mirror of mirrors) await teardownMirror(ctx, tripId, mirror.userId);
}

async function deleteTripRows(tx: Tx, tripId: string): Promise<void> {
  for (const table of TRIP_DATA_TABLES) await tx.delete(table).where(eq(table.tripId, tripId));
  await tx.delete(t.trips).where(eq(t.trips.id, tripId));
}

export async function deleteTrip(ctx: ServiceContext, tripId: string, requester: Requester): Promise<void> {
  const agg = await requireAggregate(ctx.db, tripId);
  if (permissionsFor(agg, requester).role !== "owner") throw new AccessDenied("Only the trip owner can delete a trip.");
  await teardownTripMirrors(ctx, tripId);
  await ctx.db.transaction((tx) => deleteTripRows(tx, tripId));
}

export interface AccountDeletion {
  blockedBy: { tripId: string; name: string }[];
}

type Reader = Pick<ServiceContext["db"], "select" | "selectDistinct">;

export async function tripsBlockingDeletion(db: Reader, userId: string): Promise<{ tripId: string; name: string }[]> {
  const owned = await db.select({ id: t.trips.id, name: t.trips.name }).from(t.trips).where(eq(t.trips.ownerId, userId));
  if (owned.length === 0) return [];
  const shared = await db
    .selectDistinct({ tripId: t.memberships.tripId })
    .from(t.memberships)
    .where(and(inArray(t.memberships.tripId, owned.map((o) => o.id)), ne(t.memberships.userId, userId)));
  const sharedIds = new Set(shared.map((s) => s.tripId));
  return owned.filter((o) => sharedIds.has(o.id)).map((o) => ({ tripId: o.id, name: o.name }));
}

const ownerOfTrip = (tripId: AnyPgColumn) => sql<string>`(select ${t.trips.ownerId} from ${t.trips} where ${t.trips.id} = ${tripId})`;

async function removeItems(tx: Tx, itemIds: string[]): Promise<void> {
  if (itemIds.length === 0) return;
  await tx.delete(t.activity).where(inArray(t.activity.itemId, itemIds));
  await tx.delete(t.importedItems).where(inArray(t.importedItems.resultItemId, itemIds));
  await tx.delete(t.items).where(inArray(t.items.id, itemIds));
}

async function settleHiddenItems(tx: Tx, userId: string, removeAll: boolean): Promise<Set<string>> {
  const hidden = await tx
    .select({ id: t.items.id, tripId: t.items.tripId, visibility: t.items.visibility, visibleTo: t.items.visibleToUserIds })
    .from(t.items)
    .where(and(eq(t.items.createdBy, userId), ne(t.items.visibility, "everyone")))
    .orderBy(asc(t.items.id));
  const doomed: string[] = [];
  for (const item of hidden) {
    if (removeAll || item.visibility === "only_me") {
      doomed.push(item.id);
      continue;
    }
    const members = await tx.select({ userId: t.memberships.userId }).from(t.memberships).where(and(eq(t.memberships.tripId, item.tripId), ne(t.memberships.userId, userId)));
    const staying = new Set(members.map((m) => m.userId));
    const successor = item.visibleTo.find((id) => id !== userId && staying.has(id));
    if (!successor) {
      doomed.push(item.id);
      continue;
    }
    await tx
      .update(t.items)
      .set({ createdBy: successor, updatedBy: successor, visibleToUserIds: item.visibleTo.filter((id) => id !== userId) })
      .where(eq(t.items.id, item.id));
  }
  await removeItems(tx, doomed);
  return new Set(hidden.map((h) => h.tripId));
}

export async function deleteAccount(ctx: ServiceContext, userId: string, opts: { removeHiddenItemsInSharedTrips: boolean }): Promise<AccountDeletion> {
  const [user] = await ctx.db.select().from(t.users).where(eq(t.users.id, userId));
  if (!user) throw new NotFound("That account does not exist.");
  const blockedBy = await tripsBlockingDeletion(ctx.db, userId);
  if (blockedBy.length > 0) return { blockedBy };

  const owned = await ctx.db.select({ id: t.trips.id }).from(t.trips).where(eq(t.trips.ownerId, userId));
  for (const trip of owned) await teardownTripMirrors(ctx, trip.id);
  const mirrors = await ctx.db.select({ tripId: t.calendarMirrors.tripId }).from(t.calendarMirrors).where(eq(t.calendarMirrors.userId, userId));
  for (const mirror of mirrors) await teardownMirror(ctx, mirror.tripId, userId);

  const settled = new Set<string>();
  const outcome = await ctx.db.transaction(async (tx): Promise<AccountDeletion> => {
    const lateBlockers = await tripsBlockingDeletion(tx, userId);
    if (lateBlockers.length > 0) return { blockedBy: lateBlockers };

    const ownedNow = await tx.select({ id: t.trips.id }).from(t.trips).where(eq(t.trips.ownerId, userId));
    for (const trip of ownedNow) await deleteTripRows(tx, trip.id);

    for (const tripId of await settleHiddenItems(tx, userId, opts.removeHiddenItemsInSharedTrips)) settled.add(tripId);
    const visibleToUser = await tx
      .select({ id: t.items.id, ids: t.items.visibleToUserIds })
      .from(t.items)
      .where(sql`${t.items.visibleToUserIds} @> ${JSON.stringify([userId])}::jsonb`);
    for (const row of visibleToUser) {
      await tx.update(t.items).set({ visibleToUserIds: row.ids.filter((id) => id !== userId) }).where(eq(t.items.id, row.id));
    }

    await tx.update(t.items).set({ createdBy: ownerOfTrip(t.items.tripId) }).where(eq(t.items.createdBy, userId));
    await tx.update(t.items).set({ updatedBy: ownerOfTrip(t.items.tripId) }).where(eq(t.items.updatedBy, userId));
    await tx.update(t.importBatches).set({ userId: ownerOfTrip(t.importBatches.tripId) }).where(eq(t.importBatches.userId, userId));
    await tx.update(t.checkDismissals).set({ dismissedBy: ownerOfTrip(t.checkDismissals.tripId) }).where(eq(t.checkDismissals.dismissedBy, userId));
    await tx.update(t.activity).set({ actorId: ownerOfTrip(t.activity.tripId) }).where(eq(t.activity.actorId, userId));
    await tx.update(t.importedItems).set({ decidedBy: null }).where(eq(t.importedItems.decidedBy, userId));
    await tx.update(t.deadlines).set({ confirmedBy: null }).where(eq(t.deadlines.confirmedBy, userId));
    await tx.update(t.invites).set({ acceptedBy: null }).where(eq(t.invites.acceptedBy, userId));
    await tx.delete(t.invites).where(eq(t.invites.createdBy, userId));

    await tx.delete(t.memberships).where(eq(t.memberships.userId, userId));
    await tx.delete(t.googleConnections).where(eq(t.googleConnections.userId, userId));
    await tx.delete(t.authSessions).where(eq(t.authSessions.userId, userId));
    await tx.delete(t.authAccounts).where(eq(t.authAccounts.userId, userId));
    await tx.delete(t.assistantTokens).where(eq(t.assistantTokens.userId, userId));
    await tx.delete(t.authVerificationTokens).where(sql`lower(${t.authVerificationTokens.identifier}) = ${user.email.toLowerCase()}`);
    await tx.delete(t.users).where(eq(t.users.id, userId));
    return { blockedBy: [] };
  });
  for (const tripId of settled) {
    for (const mirror of await syncTripMirrors(ctx, tripId)) {
      if (mirror.status === "failed") console.error(`Calendar mirror for ${mirror.userId} on ${tripId} failed after an account deletion`);
    }
  }
  return outcome;
}

export async function hasSharedSpecificItems(ctx: ServiceContext, userId: string): Promise<boolean> {
  const [row] = await ctx.db
    .select({ id: t.items.id })
    .from(t.items)
    .innerJoin(t.trips, eq(t.trips.id, t.items.tripId))
    .where(and(eq(t.items.createdBy, userId), eq(t.items.visibility, "specific"), ne(t.trips.ownerId, userId)))
    .limit(1);
  return row !== undefined;
}
