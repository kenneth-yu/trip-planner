import { and, asc, eq, inArray } from "drizzle-orm";
import * as t from "../db/schema";
import { saveItem, touchTrip, type DbOrTx } from "../repo/trip-repo";
import type { ServiceContext } from "./context";
import { placeContextFor } from "./place-service";
import { logActivity, NotFound, proposalToItem, requireAggregate } from "./trip-service";
import { assertCanEditItem, assertCanEditTrip, canSeeItem, permissionsFor, projectTrip } from "@/domain/visibility/project";
import { isClean, planCalendarImport, planProposals, type InboxEntryDraft } from "@/domain/import/pipeline";
import { applyDifference, mergeRecords, sharedDifferences, type Choices } from "@/domain/import/matching";
import type { CalendarEvent } from "@/domain/import/calendar-event";
import type { Difference, ImportSource, ProposedItem } from "@/domain/import/proposal";
import type { Finding } from "@/domain/checks/checks";
import type { Requester } from "@/domain/types";

export class NeedsDecision extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NeedsDecision";
  }
}

export interface BatchInput {
  source: ImportSource;
  label: string;
  via?: string;
}

async function insertBatch(ctx: ServiceContext, tripId: string, requester: Requester, batch: BatchInput, drafts: InboxEntryDraft[]) {
  if (requester.kind !== "member") throw new NotFound();
  const batchId = ctx.newId();
  await ctx.db.transaction(async (tx) => {
    await tx.insert(t.importBatches).values({ id: batchId, tripId, userId: requester.userId, source: batch.source, label: batch.label });
    if (drafts.length) {
      await tx.insert(t.importedItems).values(
        drafts.map((d) => ({
          id: ctx.newId(),
          batchId,
          tripId,
          raw: d.raw,
          proposed: d.proposed,
          matchItemId: d.match?.itemId ?? null,
          matchStrength: d.match?.strength ?? null,
          differences: d.differences,
          matchDifferences: d.match?.differences ?? [],
          unparsed: d.unparsed,
        })),
      );
    }
    await logActivity(tx, { tripId, actorId: requester.userId, action: "imported", via: batch.via, after: { batchId, count: drafts.length, source: batch.source } });
  });
  return { batchId, count: drafts.length };
}

export async function importCalendarEvents(
  ctx: ServiceContext,
  tripId: string,
  requester: Requester,
  events: CalendarEvent[],
  opts: BatchInput & { calendarTravelers?: Record<string, string[]>; travelerIds?: string[] },
) {
  const agg = await requireAggregate(ctx.db, tripId);
  assertCanEditTrip(agg, requester);
  const view = projectTrip(agg, requester);
  const me = agg.travelers.find((x) => requester.kind === "member" && x.userId === requester.userId);
  const places = await placeContextFor(ctx, view.items, requester.homeZone, events.map((e) => ({ address: e.location || undefined })));
  const drafts = planCalendarImport(events, view.items, {
    calendarTravelers: opts.calendarTravelers ?? {},
    defaultTravelerIds: opts.travelerIds ?? (me ? [me.id] : agg.travelers.map((x) => x.id)),
    homeZone: requester.homeZone,
    geocode: places.geocode,
  });
  return insertBatch(ctx, tripId, requester, opts, drafts);
}

export async function importProposals(ctx: ServiceContext, tripId: string, requester: Requester, proposals: ProposedItem[], opts: BatchInput) {
  const agg = await requireAggregate(ctx.db, tripId);
  assertCanEditTrip(agg, requester);
  const view = projectTrip(agg, requester);
  return insertBatch(ctx, tripId, requester, opts, planProposals(proposals, view.items));
}

export interface InboxEntry {
  id: string;
  batchId: string;
  source: ImportSource;
  label: string;
  proposed: ProposedItem;
  match: { itemId: string; strength: "strong" | "possible"; title: string; differences: Difference[] } | null;
  differences: Difference[];
  unparsed: string[];
  clean: boolean;
  createdAt: string;
}

export async function listInbox(ctx: ServiceContext, tripId: string, requester: Requester): Promise<InboxEntry[]> {
  const agg = await requireAggregate(ctx.db, tripId);
  assertCanEditTrip(agg, requester);
  const rows = await ctx.db
    .select({ e: t.importedItems, b: t.importBatches })
    .from(t.importedItems)
    .innerJoin(t.importBatches, eq(t.importBatches.id, t.importedItems.batchId))
    .where(and(eq(t.importedItems.tripId, tripId), eq(t.importedItems.state, "pending")))
    .orderBy(asc(t.importedItems.createdAt));
  return rows.map(({ e, b }) => {
    const matched = e.matchItemId ? agg.items.find((i) => i.id === e.matchItemId) : undefined;
    const visibleMatch = matched && e.matchStrength && canSeeItem(matched, requester) ? { item: matched, strength: e.matchStrength } : undefined;
    const entry = {
      id: e.id,
      batchId: b.id,
      source: b.source,
      label: b.label,
      proposed: e.proposed,
      match: visibleMatch ? { itemId: visibleMatch.item.id, strength: visibleMatch.strength, title: visibleMatch.item.title, differences: e.matchDifferences } : null,
      differences: e.differences,
      unparsed: e.unparsed,
      createdAt: e.createdAt.toISOString(),
    };
    return { ...entry, clean: isClean(entry) };
  });
}

async function loadEntry(db: DbOrTx, tripId: string, entryId: string) {
  const [row] = await db
    .select()
    .from(t.importedItems)
    .where(and(eq(t.importedItems.id, entryId), eq(t.importedItems.tripId, tripId), eq(t.importedItems.state, "pending")));
  if (!row) throw new NotFound("That inbox item is gone. It may already have been handled.");
  return row;
}

async function claimEntry(
  db: DbOrTx,
  entryId: string,
  decision: { state: "approved" | "merged" | "discarded"; decidedBy: string; decidedAt: Date; resultItemId?: string },
) {
  const claimed = await db
    .update(t.importedItems)
    .set(decision)
    .where(and(eq(t.importedItems.id, entryId), eq(t.importedItems.state, "pending")))
    .returning({ id: t.importedItems.id });
  if (!claimed.length) throw new NotFound("That inbox item is gone. It may already have been handled.");
}

export function resolveImportDifferences(proposed: ProposedItem, differences: Difference[], choices: Choices): ProposedItem {
  const out = structuredClone(proposed);
  for (const d of differences) {
    const pick = choices[d.field];
    if (pick === undefined || pick < 0 || pick >= d.options.length) {
      throw new NeedsDecision(`Choose a value for ${d.field}: ${d.values.join(" or ")}.`);
    }
    applyDifference(out, d, pick);
  }
  return out;
}

export interface Decision {
  choices?: Choices;
  edits?: Partial<ProposedItem>;
}

export async function approveEntry(ctx: ServiceContext, tripId: string, entryId: string, requester: Requester, decision: Decision = {}) {
  if (requester.kind !== "member") throw new NotFound();
  const itemId = await ctx.db.transaction(async (tx) => {
    const agg = await requireAggregate(tx, tripId);
    assertCanEditTrip(agg, requester);
    const row = await loadEntry(tx, tripId, entryId);
    const resolved = resolveImportDifferences(row.proposed, row.differences, decision.choices ?? {});
    const proposal = decision.edits ? { ...resolved, ...decision.edits, status: "confirmed" as const, problems: [] } : resolved;
    const item = proposalToItem(ctx, tripId, requester.userId, proposal);
    await claimEntry(tx, entryId, { state: "approved", resultItemId: item.id, decidedBy: requester.userId, decidedAt: ctx.now() });
    await saveItem(tx, item);
    await touchTrip(tx, tripId);
    await logActivity(tx, { tripId, actorId: requester.userId, action: "created", itemId: item.id, via: `import:${row.batchId}`, after: item });
    return item.id;
  });
  await ctx.onTripChanged(tripId);
  return itemId;
}

export async function mergeEntry(
  ctx: ServiceContext,
  tripId: string,
  entryId: string,
  requester: Requester,
  decision: Decision & { intoItemId?: string; keep?: Choices } = {},
) {
  if (requester.kind !== "member") throw new NotFound();
  const itemId = await ctx.db.transaction(async (tx) => {
    const agg = await requireAggregate(tx, tripId);
    const row = await loadEntry(tx, tripId, entryId);
    const target = agg.items.find((i) => i.id === (decision.intoItemId ?? row.matchItemId));
    if (!target) throw new NotFound("There is nothing to merge this into.");
    assertCanEditItem(agg, requester, target);
    const incoming = resolveImportDifferences(row.proposed, row.differences, decision.choices ?? {});
    const diffs = sharedDifferences(target, incoming);
    for (const d of diffs) {
      if (decision.keep?.[d.field] === undefined) throw new NeedsDecision(`Choose ${d.field}: ${d.values.join(" (current) or ")} (imported).`);
    }
    const merged = mergeRecords(target, incoming, diffs, decision.keep ?? {});
    const known = new Set(target.deadlines.map((d) => d.id));
    const after = {
      ...merged,
      deadlines: merged.deadlines.map((d) =>
        "id" in d && known.has(d.id)
          ? d
          : { id: ctx.newId(), itemId: target.id, kind: d.kind, at: d.at, consequence: d.consequence, source: d.source, confirmedBy: null },
      ),
      updatedBy: requester.userId,
      updatedAt: ctx.now().toISOString(),
    };
    await claimEntry(tx, entryId, { state: "merged", resultItemId: target.id, decidedBy: requester.userId, decidedAt: ctx.now() });
    await saveItem(tx, after);
    await touchTrip(tx, tripId);
    await logActivity(tx, { tripId, actorId: requester.userId, action: "merged", itemId: target.id, via: `import:${row.batchId}`, before: target, after });
    return target.id;
  });
  await ctx.onTripChanged(tripId);
  return itemId;
}

export async function discardEntry(ctx: ServiceContext, tripId: string, entryId: string, requester: Requester) {
  if (requester.kind !== "member") throw new NotFound();
  const agg = await requireAggregate(ctx.db, tripId);
  assertCanEditTrip(agg, requester);
  await loadEntry(ctx.db, tripId, entryId);
  await claimEntry(ctx.db, entryId, { state: "discarded", decidedBy: requester.userId, decidedAt: ctx.now() });
}

export async function approveAllClean(ctx: ServiceContext, tripId: string, requester: Requester): Promise<number> {
  const clean = (await listInbox(ctx, tripId, requester)).filter((e) => e.clean);
  for (const e of clean) await approveEntry(ctx, tripId, e.id, requester);
  return clean.length;
}

export async function disagreementFindings(ctx: ServiceContext, tripId: string, requester: Requester): Promise<Finding[]> {
  const agg = await requireAggregate(ctx.db, tripId);
  if (!permissionsFor(agg, requester).canEdit) return [];
  const entries = await listInbox(ctx, tripId, requester);
  return entries
    .flatMap((e) =>
      [...e.differences, ...(e.match?.differences ?? [])].map((d) => ({
        key: `records_disagree|${e.id}|${d.field}`,
        kind: "records_disagree" as const,
        sentence: `Two records for ${e.proposed.title} disagree on ${d.field === "start" ? "departure" : d.field === "end" ? "arrival" : d.field}: ${d.values.join(" and ")}.`,
        itemIds: e.match ? [e.match.itemId] : [],
      })),
    );
}

export async function pendingCount(ctx: ServiceContext, tripIds: string[]) {
  if (!tripIds.length) return 0;
  const rows = await ctx.db.select({ id: t.importedItems.id }).from(t.importedItems).where(and(inArray(t.importedItems.tripId, tripIds), eq(t.importedItems.state, "pending")));
  return rows.length;
}
