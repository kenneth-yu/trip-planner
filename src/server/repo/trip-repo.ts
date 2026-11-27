import { and, eq, inArray } from "drizzle-orm";
import type { Db } from "../db/client";
import * as t from "../db/schema";
import type { Deadline, Item, ItemPrivate, TripAggregate } from "@/domain/types";

const iso = (d: Date) => d.toISOString();

export type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];
export type DbOrTx = Db | Tx;

export async function loadTripAggregate(db: DbOrTx, tripId: string): Promise<TripAggregate | null> {
  const [trip] = await db.select().from(t.trips).where(eq(t.trips.id, tripId));
  if (!trip) return null;
  const [memberships, travelers, rows, link] = await Promise.all([
    db.select().from(t.memberships).where(eq(t.memberships.tripId, tripId)),
    db.select().from(t.travelers).where(eq(t.travelers.tripId, tripId)),
    db.select().from(t.items).where(eq(t.items.tripId, tripId)),
    db.select().from(t.shareLinks).where(eq(t.shareLinks.tripId, tripId)),
  ]);
  const ids = rows.map((r) => r.id);
  const [privates, dls] = ids.length
    ? await Promise.all([
        db.select().from(t.itemPrivate).where(inArray(t.itemPrivate.itemId, ids)),
        db.select().from(t.deadlines).where(inArray(t.deadlines.itemId, ids)),
      ])
    : [[], []];
  return {
    trip: {
      id: trip.id,
      name: trip.name,
      ownerId: trip.ownerId,
      viewersSeeDeadlines: trip.viewersSeeDeadlines,
      createdAt: iso(trip.createdAt),
      updatedAt: iso(trip.updatedAt),
    },
    memberships: memberships.map((m) => ({ tripId: m.tripId, userId: m.userId, role: m.role })),
    travelers: travelers.map((x) => ({ id: x.id, tripId: x.tripId, name: x.name, userId: x.userId })),
    items: rows.map((r) =>
      rowToItem(
        r,
        privates.filter((p) => p.itemId === r.id),
        dls.filter((d) => d.itemId === r.id),
      ),
    ),
    shareLink: link[0] ? { enabled: link[0].enabled, showsDeadlines: link[0].showsDeadlines } : null,
  };
}

function rowToItem(r: typeof t.items.$inferSelect, privates: (typeof t.itemPrivate.$inferSelect)[], dls: (typeof t.deadlines.$inferSelect)[]): Item {
  return {
    id: r.id,
    tripId: r.tripId,
    type: r.type,
    title: r.title,
    start: { at: iso(r.startAt), zone: r.startZone },
    end: { at: iso(r.endAt), zone: r.endZone },
    startIsEstimated: r.startIsEstimated,
    endIsEstimated: r.endIsEstimated,
    location: r.location ?? null,
    ...r.details,
    travelerIds: r.travelerIds,
    visibility: r.visibility,
    visibleToUserIds: r.visibleToUserIds,
    showAsBusy: r.showAsBusy,
    status: r.status,
    notes: r.notes,
    flags: r.flags,
    private: privates.map((p): ItemPrivate => ({ travelerId: p.travelerId, ...p.data })),
    deadlines: dls.map(
      (d): Deadline => ({
        id: d.id,
        itemId: d.itemId,
        kind: d.kind,
        at: { at: iso(d.at), zone: d.zone },
        consequence: d.consequence,
        source: d.source,
        confirmedBy: d.confirmedBy,
      }),
    ),
    createdBy: r.createdBy,
    updatedBy: r.updatedBy,
    createdAt: iso(r.createdAt),
    updatedAt: iso(r.updatedAt),
  };
}

export async function saveItem(db: DbOrTx, item: Item): Promise<void> {
  const row = {
    id: item.id,
    tripId: item.tripId,
    type: item.type,
    title: item.title,
    startAt: new Date(item.start.at),
    startZone: item.start.zone,
    endAt: new Date(item.end.at),
    endZone: item.end.zone,
    startIsEstimated: item.startIsEstimated,
    endIsEstimated: item.endIsEstimated,
    location: item.location,
    details: { flight: item.flight, stay: item.stay, transfer: item.transfer },
    travelerIds: item.travelerIds,
    visibility: item.visibility,
    visibleToUserIds: item.visibleToUserIds,
    showAsBusy: item.showAsBusy,
    status: item.status,
    notes: item.notes,
    flags: item.flags,
    createdBy: item.createdBy,
    updatedBy: item.updatedBy,
    createdAt: new Date(item.createdAt),
    updatedAt: new Date(item.updatedAt),
  };
  await db.insert(t.items).values(row).onConflictDoUpdate({ target: t.items.id, set: row });
  await db.delete(t.itemPrivate).where(eq(t.itemPrivate.itemId, item.id));
  await db.delete(t.deadlines).where(eq(t.deadlines.itemId, item.id));
  if (item.private.length) {
    await db.insert(t.itemPrivate).values(
      item.private.map(({ travelerId, ...data }) => ({ itemId: item.id, travelerId, data })),
    );
  }
  if (item.deadlines.length) {
    await db.insert(t.deadlines).values(
      item.deadlines.map((d) => ({
        id: d.id,
        itemId: item.id,
        kind: d.kind,
        at: new Date(d.at.at),
        zone: d.at.zone,
        consequence: d.consequence,
        source: d.source,
        confirmedBy: d.confirmedBy,
      })),
    );
  }
}

export async function deleteItem(db: DbOrTx, tripId: string, itemId: string): Promise<void> {
  await db.delete(t.items).where(and(eq(t.items.tripId, tripId), eq(t.items.id, itemId)));
}

export async function touchTrip(db: DbOrTx, tripId: string): Promise<void> {
  await db.update(t.trips).set({ updatedAt: new Date() }).where(eq(t.trips.id, tripId));
}

export async function tripsForUser(db: DbOrTx, userId: string) {
  return db
    .select({ id: t.trips.id, name: t.trips.name, role: t.memberships.role })
    .from(t.memberships)
    .innerJoin(t.trips, eq(t.trips.id, t.memberships.tripId))
    .where(eq(t.memberships.userId, userId));
}
