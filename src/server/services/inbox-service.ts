import { and, asc, eq, inArray } from "drizzle-orm";
import * as t from "../db/schema";
import { saveItem, touchTrip, type DbOrTx } from "../repo/trip-repo";
import type { ServiceContext } from "./context";
import { placeContextFor } from "./place-service";
import { NotFound, proposalToItem, requireAggregate } from "./trip-service";
import { openJson, SealError, sealJson } from "../crypto/sealed";
import { importPayloadSchema } from "../crypto/schemas";
import { insertActivity } from "../repo/activity-repo";
import { assertCanEditItem, assertCanEditTrip, canSeeItem, permissionsFor, projectTrip } from "@/domain/visibility/project";
import { isClean, planCalendarImport, planProposals, type InboxEntryDraft } from "@/domain/import/pipeline";
import { applyDifference, mergeRecords, sharedDifferences, type Choices } from "@/domain/import/matching";
import type { CalendarEvent } from "@/domain/import/calendar-event";
import type { Difference, ImportSource, ProposedItem } from "@/domain/import/proposal";
import type { Finding } from "@/domain/checks/checks";
import type { ItemPrivate, Requester } from "@/domain/types";
import { InvalidTransition, transition } from "@/domain/state/machine";
import { machine as inboxEntry, type InboxEntryEvent, type InboxEntryState } from "@/domain/state/inbox-entry.machine";

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
        drafts.map((d) => {
          const id = ctx.newId();
          return {
            id,
            batchId,
            tripId,
            sealed: sealJson({ raw: d.raw, proposed: d.proposed, unparsed: d.unparsed }, "import", id),
            matchItemId: d.match?.itemId ?? null,
            matchStrength: d.match?.strength ?? null,
            differences: d.differences,
            matchDifferences: d.match?.differences ?? [],
          };
        }),
      );
    }
    await insertActivity(tx, { tripId, actorId: requester.userId, action: "imported", via: batch.via, after: { batchId, count: drafts.length, source: batch.source } });
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

function openImport(row: typeof t.importedItems.$inferSelect) {
  if (row.sealed === null) throw new SealError("Imported record has not been sealed yet.");
  return openJson(row.sealed, importPayloadSchema, "import", row.id);
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
  namesRemovedTraveler: boolean;
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
  const travelerIds = new Set(agg.travelers.map((x) => x.id));
  return rows.map(({ e, b }) => {
    const matched = e.matchItemId ? agg.items.find((i) => i.id === e.matchItemId) : undefined;
    const visibleMatch = matched && e.matchStrength && canSeeItem(matched, requester) ? { item: matched, strength: e.matchStrength } : undefined;
    const opened = openImport(e);
    const entry = {
      id: e.id,
      batchId: b.id,
      source: b.source,
      label: b.label,
      proposed: opened.proposed,
      match: visibleMatch ? { itemId: visibleMatch.item.id, strength: visibleMatch.strength, title: visibleMatch.item.title, differences: e.matchDifferences } : null,
      differences: e.differences,
      unparsed: opened.unparsed,
      createdAt: e.createdAt.toISOString(),
    };
    const namesRemovedTraveler = opened.proposed.travelerIds.some((id) => !travelerIds.has(id));
    return { ...entry, namesRemovedTraveler, clean: isClean(entry) && !namesRemovedTraveler };
  });
}

type StoredState = typeof t.importedItems.$inferSelect["state"];

const STATE_OF_STORED: Record<StoredState, InboxEntryState> = { pending: "Pending", approved: "Approved", merged: "Merged", discarded: "Discarded" };
const STORED_OF_STATE: Record<InboxEntryState, StoredState> = { Pending: "pending", Approved: "approved", Merged: "merged", Discarded: "discarded" };

async function loadEntry(db: DbOrTx, tripId: string, entryId: string, event: InboxEntryEvent) {
  const [row] = await db
    .select()
    .from(t.importedItems)
    .where(and(eq(t.importedItems.id, entryId), eq(t.importedItems.tripId, tripId)));
  if (!row) throw new NotFound("That inbox item is gone.");
  transition(inboxEntry, STATE_OF_STORED[row.state], event);
  return { ...row, proposed: openImport(row).proposed };
}

async function claimEntry(db: DbOrTx, entryId: string, event: InboxEntryEvent, decision: { decidedBy: string; decidedAt: Date; resultItemId?: string }) {
  const next = transition(inboxEntry, "Pending", event);
  const claimed = await db
    .update(t.importedItems)
    .set({ ...decision, state: STORED_OF_STATE[next] })
    .where(and(eq(t.importedItems.id, entryId), eq(t.importedItems.state, STORED_OF_STATE.Pending)))
    .returning({ id: t.importedItems.id });
  if (claimed.length) return;
  const [current] = await db.select({ state: t.importedItems.state }).from(t.importedItems).where(eq(t.importedItems.id, entryId));
  if (!current) throw new NotFound("That inbox item is gone.");
  throw new InvalidTransition(inboxEntry.name, STATE_OF_STORED[current.state], event);
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

export interface Saved {
  itemId: string;
  withoutRemovedTraveler: boolean;
  proposed: ProposedItem;
}

function onlyKnownTravelers<T extends { travelerIds: string[]; private: ItemPrivate[] }>(record: T, known: Set<string>): { record: T; dropped: boolean } {
  const travelerIds = record.travelerIds.filter((id) => known.has(id));
  const owned = (p: ItemPrivate) => p.travelerId === null || known.has(p.travelerId);
  const priv = record.private.map((p) => (owned(p) ? p : { ...p, travelerId: null, seat: undefined }));
  const dropped = travelerIds.length !== record.travelerIds.length || priv.some((p, i) => p !== record.private[i]);
  return { record: { ...record, travelerIds, private: priv }, dropped };
}

export async function approveEntry(ctx: ServiceContext, tripId: string, entryId: string, requester: Requester, decision: Decision = {}): Promise<Saved> {
  if (requester.kind !== "member") throw new NotFound();
  const saved = await ctx.db.transaction(async (tx) => {
    const agg = await requireAggregate(tx, tripId);
    assertCanEditTrip(agg, requester);
    const row = await loadEntry(tx, tripId, entryId, "add");
    const resolved = resolveImportDifferences(row.proposed, row.differences, decision.choices ?? {});
    const edited = decision.edits ? { ...resolved, ...decision.edits, status: "confirmed" as const, problems: [] } : resolved;
    const { record: proposal, dropped } = onlyKnownTravelers(edited, new Set(agg.travelers.map((x) => x.id)));
    const item = proposalToItem(ctx, tripId, requester.userId, proposal);
    await claimEntry(tx, entryId, "add", { resultItemId: item.id, decidedBy: requester.userId, decidedAt: ctx.now() });
    await saveItem(tx, item);
    await touchTrip(tx, tripId);
    await insertActivity(tx, { tripId, actorId: requester.userId, action: "created", itemId: item.id, via: `import:${row.batchId}`, after: item });
    return { itemId: item.id, withoutRemovedTraveler: dropped, proposed: row.proposed };
  });
  await ctx.onTripChanged(tripId);
  return saved;
}

export async function mergeEntry(
  ctx: ServiceContext,
  tripId: string,
  entryId: string,
  requester: Requester,
  decision: Decision & { intoItemId?: string; keep?: Choices } = {},
): Promise<Saved> {
  if (requester.kind !== "member") throw new NotFound();
  const saved = await ctx.db.transaction(async (tx) => {
    const agg = await requireAggregate(tx, tripId);
    assertCanEditTrip(agg, requester);
    const row = await loadEntry(tx, tripId, entryId, "merge");
    const target = agg.items.find((i) => i.id === (decision.intoItemId ?? row.matchItemId));
    if (!target) throw new NotFound("There is nothing to merge this into.");
    assertCanEditItem(agg, requester, target);
    const { record: incoming, dropped } = onlyKnownTravelers(resolveImportDifferences(row.proposed, row.differences, decision.choices ?? {}), new Set(agg.travelers.map((x) => x.id)));
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
    await claimEntry(tx, entryId, "merge", { resultItemId: target.id, decidedBy: requester.userId, decidedAt: ctx.now() });
    await saveItem(tx, after);
    await touchTrip(tx, tripId);
    await insertActivity(tx, { tripId, actorId: requester.userId, action: "merged", itemId: target.id, via: `import:${row.batchId}`, before: target, after });
    return { itemId: target.id, withoutRemovedTraveler: dropped, proposed: row.proposed };
  });
  await ctx.onTripChanged(tripId);
  return saved;
}

export async function discardEntry(ctx: ServiceContext, tripId: string, entryId: string, requester: Requester) {
  if (requester.kind !== "member") throw new NotFound();
  const agg = await requireAggregate(ctx.db, tripId);
  assertCanEditTrip(agg, requester);
  await loadEntry(ctx.db, tripId, entryId, "discard");
  await claimEntry(ctx.db, entryId, "discard", { decidedBy: requester.userId, decidedAt: ctx.now() });
}

export interface AddAllResult {
  added: number;
  alreadyDecided: number;
  needYou: number;
}

export async function approveAllClean(ctx: ServiceContext, tripId: string, requester: Requester): Promise<AddAllResult> {
  const clean = (await listInbox(ctx, tripId, requester)).filter((e) => e.clean);
  const result: AddAllResult = { added: 0, alreadyDecided: 0, needYou: 0 };
  for (const e of clean) {
    try {
      await approveEntry(ctx, tripId, e.id, requester);
      result.added += 1;
    } catch (err) {
      if (err instanceof InvalidTransition || err instanceof NotFound) result.alreadyDecided += 1;
      else if (err instanceof NeedsDecision) result.needYou += 1;
      else throw err;
    }
  }
  return result;
}

export interface DecidedEntry {
  state: "approved" | "merged" | "discarded";
  by: string | null;
  proposed: ProposedItem;
}

export async function decidedEntry(ctx: ServiceContext, tripId: string, entryId: string, requester: Requester): Promise<DecidedEntry | null> {
  if (requester.kind !== "member") throw new NotFound();
  assertCanEditTrip(await requireAggregate(ctx.db, tripId), requester);
  const [row] = await ctx.db.select().from(t.importedItems).where(and(eq(t.importedItems.id, entryId), eq(t.importedItems.tripId, tripId)));
  if (!row || row.state === "pending") return null;
  const [member] = row.decidedBy
    ? await ctx.db
        .select({ name: t.users.name })
        .from(t.memberships)
        .innerJoin(t.users, eq(t.users.id, t.memberships.userId))
        .where(and(eq(t.memberships.tripId, tripId), eq(t.memberships.userId, row.decidedBy)))
    : [];
  const by = row.decidedBy === requester.userId ? "You" : (member?.name.split(" ")[0] ?? null);
  return { state: row.state, by, proposed: openImport(row).proposed };
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
