import { createHash } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { z } from "zod";
import * as t from "../db/schema";
import { deleteItem, loadTripAggregate, lockItemRow, saveItem, touchTrip, tripsForUser, UnknownTraveler, type DbOrTx } from "../repo/trip-repo";
import { insertActivity } from "../repo/activity-repo";
import type { ServiceContext } from "./context";
import { AccessDenied, assertCanEditItem, assertCanEditTrip, canSeeItem, projectTrip, type TripView } from "@/domain/visibility/project";
import { itemPatchSchema, type ItemPatch } from "@/domain/item-patch";
import { inputToProposal, InputProblem, placeQueries } from "@/domain/import/quick-add";
import { placeContextFor } from "./place-service";
import type { ProposedItem } from "@/domain/import/proposal";
import type { Item, Requester, TripAggregate, Visibility } from "@/domain/types";

export class NotFound extends Error {
  constructor(message = "That trip or item does not exist, or you cannot see it.") {
    super(message);
    this.name = "NotFound";
  }
}

export async function requireAggregate(db: DbOrTx, tripId: string): Promise<TripAggregate> {
  const agg = await loadTripAggregate(db, tripId);
  if (!agg) throw new NotFound();
  return agg;
}

export async function getTripView(ctx: ServiceContext, tripId: string, requester: Requester): Promise<TripView> {
  return projectTrip(await requireAggregate(ctx.db, tripId), requester);
}

export async function listTrips(ctx: ServiceContext, userId: string) {
  return tripsForUser(ctx.db, userId);
}

export async function createTrip(ctx: ServiceContext, owner: { id: string; name: string }, name: string): Promise<string> {
  const trimmed = name.trim();
  if (!trimmed) throw new InputProblem("Enter a trip name.");
  const tripId = ctx.newId();
  await ctx.db.transaction(async (tx) => {
    await tx.insert(t.trips).values({ id: tripId, name: trimmed, ownerId: owner.id });
    await tx.insert(t.memberships).values({ tripId, userId: owner.id, role: "owner" });
    await tx.insert(t.travelers).values({ id: ctx.newId(), tripId, name: owner.name, userId: owner.id });
  });
  return tripId;
}

export interface ItemSharing {
  visibility?: Visibility;
  visibleToUserIds?: string[];
  showAsBusy?: boolean;
}

export function proposalToItem(ctx: ServiceContext, tripId: string, actorId: string, p: ProposedItem, sharing: ItemSharing = {}): Item {
  const id = ctx.newId();
  const now = ctx.now().toISOString();
  return {
    id,
    tripId,
    type: p.type,
    title: p.title,
    start: p.start,
    end: p.end,
    startIsEstimated: p.startIsEstimated,
    endIsEstimated: p.endIsEstimated,
    location: p.location,
    flight: p.flight,
    stay: p.stay,
    transfer: p.transfer,
    travelerIds: p.travelerIds,
    visibility: sharing.visibility ?? "everyone",
    visibleToUserIds: sharing.visibility === "specific" ? (sharing.visibleToUserIds ?? []) : [],
    showAsBusy: sharing.showAsBusy ?? false,
    status: p.status,
    notes: p.notes,
    flags: p.problems,
    private: p.private,
    deadlines: p.deadlines.map((d) => ({
      id: ctx.newId(),
      itemId: id,
      kind: d.kind,
      at: d.at,
      consequence: d.consequence,
      source: d.source,
      confirmedBy: d.source === "manual" ? actorId : null,
    })),
    createdBy: actorId,
    updatedBy: actorId,
    createdAt: now,
    updatedAt: now,
  };
}

function memberId(requester: Requester): string {
  if (requester.kind !== "member") throw new AccessDenied("Sign in to change this trip.");
  return requester.userId;
}

export function idempotentItemId(userId: string, tripId: string, key: string): string {
  const hex = createHash("sha256").update(`quick-add:${userId}:${tripId}:${key}`).digest("hex");
  const variant = ((Number.parseInt(hex.charAt(16), 16) & 0x3) | 0x8).toString(16);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-${variant}${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

export interface QuickAddOptions {
  idempotencyKey?: string;
}

export async function quickAddItem(
  ctx: ServiceContext,
  tripId: string,
  requester: Requester,
  input: unknown,
  sharing: ItemSharing = {},
  options: QuickAddOptions = {},
): Promise<Item> {
  const actorId = memberId(requester);
  const before = await requireAggregate(ctx.db, tripId);
  assertCanEditTrip(before, requester);
  const places = await placeContextFor(ctx, projectTrip(before, requester).items, requester.homeZone, placeQueries(input));
  const fixedId = options.idempotencyKey ? idempotentItemId(actorId, tripId, options.idempotencyKey) : null;
  const outcome = await ctx.db.transaction(async (tx) => {
    if (fixedId) await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${fixedId}))`);
    const agg = await requireAggregate(tx, tripId);
    assertCanEditTrip(agg, requester);
    const existing = fixedId ? agg.items.find((i) => i.id === fixedId) : undefined;
    if (existing) return { item: existing, added: false };
    const proposed = proposalToItem(ctx, tripId, actorId, inputToProposal(input, agg.travelers, places), sharing);
    const created = fixedId ? { ...proposed, id: fixedId } : proposed;
    await saveItem(tx, created);
    await touchTrip(tx, tripId);
    await insertActivity(tx, { tripId, actorId, action: "created", itemId: created.id, after: created });
    return { item: created, added: true };
  });
  if (outcome.added) await ctx.onTripChanged(tripId);
  return outcome.item;
}

export type { ItemPatch };

const ItemId = z.string().uuid();

async function lockItem(tx: DbOrTx, tripId: string, itemId: string): Promise<void> {
  if (!ItemId.safeParse(itemId).success) throw new NotFound();
  await lockItemRow(tx, tripId, itemId);
}

export async function updateItem(ctx: ServiceContext, tripId: string, itemId: string, requester: Requester, rawPatch: ItemPatch): Promise<Item> {
  const actorId = memberId(requester);
  const parsed = itemPatchSchema.safeParse(rawPatch);
  if (!parsed.success) throw new InputProblem("That change is not valid.");
  const patch = parsed.data;
  const updated = await ctx.db.transaction(async (tx) => {
    await lockItem(tx, tripId, itemId);
    const agg = await requireAggregate(tx, tripId);
    const before = agg.items.find((i) => i.id === itemId);
    if (!before || !canSeeItem(before, requester)) throw new NotFound();
    assertCanEditItem(agg, requester, before);
    if ((patch.visibility || patch.visibleToUserIds || patch.showAsBusy !== undefined) && before.createdBy !== actorId) {
      throw new AccessDenied("Only the person who added this can change who sees it.");
    }
    const knownTravelers = new Set(agg.travelers.map((x) => x.id));
    if (patch.travelerIds?.some((id) => !knownTravelers.has(id))) throw new UnknownTraveler();
    const travelerIds = patch.travelerIds ?? before.travelerIds;
    if (patch.private?.some((row) => row.travelerId !== null && !travelerIds.includes(row.travelerId))) throw new InputProblem("That change is not valid.");
    const reviewed = patch.status === "confirmed" || patch.location !== undefined || patch.start !== undefined || patch.end !== undefined;
    const after: Item = {
      ...before,
      ...patch,
      status: reviewed && patch.status !== "needs_review" ? "confirmed" : (patch.status ?? before.status),
      flags: patch.flags ?? (reviewed ? [] : before.flags),
      updatedBy: actorId,
      updatedAt: ctx.now().toISOString(),
    };
    if (after.end.at < after.start.at) throw new InputProblem("The end is before the start.");
    await saveItem(tx, after);
    await touchTrip(tx, tripId);
    await insertActivity(tx, { tripId, actorId, action: "updated", itemId, before, after });
    return after;
  });
  await ctx.onTripChanged(tripId);
  return updated;
}

export async function removeItem(ctx: ServiceContext, tripId: string, itemId: string, requester: Requester): Promise<void> {
  const actorId = memberId(requester);
  await ctx.db.transaction(async (tx) => {
    await lockItem(tx, tripId, itemId);
    const agg = await requireAggregate(tx, tripId);
    const before = agg.items.find((i) => i.id === itemId);
    if (!before || !canSeeItem(before, requester)) throw new NotFound();
    assertCanEditItem(agg, requester, before);
    await deleteItem(tx, tripId, itemId);
    await touchTrip(tx, tripId);
    await insertActivity(tx, { tripId, actorId, action: "deleted", itemId, before });
  });
  await ctx.onTripChanged(tripId);
}

export async function viewerTravelerId(ctx: ServiceContext, tripId: string, requester: Requester): Promise<string | null> {
  if (requester.kind !== "member") return null;
  const agg = await requireAggregate(ctx.db, tripId);
  return agg.travelers.find((x) => x.userId === requester.userId)?.id ?? null;
}

export async function getUser(ctx: ServiceContext, userId: string) {
  const [u] = await ctx.db.select().from(t.users).where(eq(t.users.id, userId));
  return u ?? null;
}
