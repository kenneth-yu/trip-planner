import { and, eq, inArray, ne, sql } from "drizzle-orm";
import type { AnyPgColumn, PgTable } from "drizzle-orm/pg-core";
import * as t from "../db/schema";
import type { ServiceContext } from "./context";
import { teardownMirror } from "./mirror-service";
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

async function removeTrip(ctx: ServiceContext, tripId: string): Promise<void> {
  const mirrors = await ctx.db.select({ userId: t.calendarMirrors.userId }).from(t.calendarMirrors).where(eq(t.calendarMirrors.tripId, tripId));
  for (const mirror of mirrors) await teardownMirror(ctx, tripId, mirror.userId);
  await ctx.db.transaction(async (tx) => {
    for (const table of TRIP_DATA_TABLES) await tx.delete(table).where(eq(table.tripId, tripId));
    await tx.delete(t.trips).where(eq(t.trips.id, tripId));
  });
}

export async function deleteTrip(ctx: ServiceContext, tripId: string, requester: Requester): Promise<void> {
  const agg = await requireAggregate(ctx.db, tripId);
  if (permissionsFor(agg, requester).role !== "owner") throw new AccessDenied("Only the trip owner can delete a trip.");
  await removeTrip(ctx, tripId);
}

export interface AccountDeletion {
  blockedBy: { tripId: string; name: string }[];
}

type Reader = Pick<ServiceContext["db"], "select" | "selectDistinct">;

async function tripsBlockingDeletion(db: Reader, userId: string): Promise<{ tripId: string; name: string }[]> {
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

export async function deleteAccount(ctx: ServiceContext, userId: string, opts: { removeHiddenItemsInSharedTrips: boolean }): Promise<AccountDeletion> {
  const [user] = await ctx.db.select().from(t.users).where(eq(t.users.id, userId));
  if (!user) throw new NotFound("That account does not exist.");
  const blockedBy = await tripsBlockingDeletion(ctx.db, userId);
  if (blockedBy.length > 0) return { blockedBy };

  const owned = await ctx.db.select({ id: t.trips.id }).from(t.trips).where(eq(t.trips.ownerId, userId));
  for (const trip of owned) await removeTrip(ctx, trip.id);
  const mirrors = await ctx.db.select({ tripId: t.calendarMirrors.tripId }).from(t.calendarMirrors).where(eq(t.calendarMirrors.userId, userId));
  for (const mirror of mirrors) await teardownMirror(ctx, mirror.tripId, userId);

  return ctx.db.transaction(async (tx) => {
    const lateBlockers = await tripsBlockingDeletion(tx, userId);
    if (lateBlockers.length > 0) return { blockedBy: lateBlockers };

    if (opts.removeHiddenItemsInSharedTrips) {
      await tx.delete(t.items).where(and(eq(t.items.createdBy, userId), ne(t.items.visibility, "everyone")));
    }
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
}
