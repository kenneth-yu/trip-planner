import { inArray, sql } from "drizzle-orm";
import { z } from "zod";
import * as t from "../db/schema";
import { insertActivity, listActivity, type StoredActivity } from "../repo/activity-repo";
import { readSnapshot } from "../repo/activity-snapshot";
import { deleteItem, lockItemRow, saveItem, touchTrip, UnknownTraveler } from "../repo/trip-repo";
import type { ServiceContext } from "./context";
import { requireAggregate } from "./trip-service";
import { canSeeIdea } from "@/domain/ideas/ideas";
import { firstName } from "@/domain/people/first-name";
import { localDateKey } from "@/domain/time/format";
import { AccessDenied, assertCanEditItem, canSeeItem, permissionsFor } from "@/domain/visibility/project";
import type { Item, Requester, TripAggregate } from "@/domain/types";

export const ACTIVITY_PAGE = 50;

const ACTIVITY_KIND = z.enum(["created", "updated", "deleted", "merged", "imported", "undone", "idea_scheduled", "idea_done", "idea_dropped", "idea_reopened"]);
export type ActivityKind = z.infer<typeof ACTIVITY_KIND>;
const KINDS: readonly string[] = ACTIVITY_KIND.options;
const IdeaActivity = z.object({ ideaId: z.string(), title: z.string(), visibility: z.enum(["everyone", "only_me", "specific"]), createdBy: z.string().nullable(), visibleToUserIds: z.array(z.string()) });
const UNDOABLE: readonly string[] = ["created", "updated", "deleted", "undone"];
const UNNAMED = "A trip member";

export interface ActivityLine {
  id: string;
  at: string;
  kind: ActivityKind;
  by: string;
  title: string | null;
  itemId: string | null;
  changed: string[];
  via: string | null;
  count: number | null;
  undid: { kind: ActivityKind; by: string } | null;
  source: string | null;
  canUndo: boolean;
}

const NOT_AN_ENTRY = "That change is not on this trip.";

export class UndoRefused extends Error {
  constructor(
    readonly reason: "changed" | "cannot_edit" | "missing",
    readonly title: string,
    readonly itemId: string | null,
  ) {
    super(reason === "changed" ? "That changed again since then, so nothing was undone." : reason === "missing" ? NOT_AN_ENTRY : "You can no longer change this item.");
    this.name = "UndoRefused";
  }
}

function actorName(name: string, email: string): string {
  const local = email.split("@")[0]?.toLowerCase();
  if (name.includes("@") || name.toLowerCase() === local) return UNNAMED;
  return firstName(name) || UNNAMED;
}

function same(a: unknown, b: unknown): boolean {
  return JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
}

function changedFields(before: Item | null, after: Item | null, canSeeSensitive: boolean, canSeeDeadlines: boolean): { names: string[]; onlyHidden: boolean } {
  if (!before || !after) return { names: [], onlyHidden: false };
  const names: string[] = [];
  const hidden: string[] = [];
  if (!same(before.title, after.title)) names.push("title");
  const startChanged = !same(before.start, after.start);
  const endChanged = !same(before.end, after.end);
  if (startChanged && endChanged) names.push("times");
  else if (startChanged) names.push(after.type === "flight" ? "departure time" : "start time");
  else if (endChanged) names.push(after.type === "flight" ? "arrival time" : "end time");
  if (!same(before.location, after.location)) names.push("place");
  if (!same(before.flight, after.flight)) names.push("flight details");
  if (!same(before.stay, after.stay)) names.push("stay details");
  if (!same(before.transfer, after.transfer)) names.push("transfer details");
  if (!same(before.travelerIds, after.travelerIds)) names.push("who it is for");
  if (!same([before.visibility, before.visibleToUserIds, before.showAsBusy], [after.visibility, after.visibleToUserIds, after.showAsBusy])) names.push("who can see it");
  if (!same(before.status, after.status)) names.push("status");
  if (!same(before.deadlines, after.deadlines)) (canSeeDeadlines ? names : hidden).push("deadlines");
  if (!same(before.private, after.private) || !same(before.notes, after.notes)) (canSeeSensitive ? names : hidden).push("booking details");
  return { names, onlyHidden: names.length === 0 && hidden.length > 0 };
}

function wouldChangeWhoSees(now: Item, target: Item): boolean {
  return now.visibility !== target.visibility || !same(now.visibleToUserIds, target.visibleToUserIds) || now.showAsBusy !== target.showAsBusy;
}

function viaLabel(via: string): string | null {
  if (via === "app") return null;
  return via.startsWith("import:") ? "from the inbox" : "from an AI assistant";
}

const SOURCE_WORDS: Record<string, string> = {
  google_calendar: "Google Calendar",
  ics: "a calendar file",
  email: "an email",
  manual: "a pasted record",
  assistant: "an AI assistant",
};

type Snapshot = { readable: true; item: Item | null } | { readable: false };

function readEntry(entryId: string, value: unknown): Snapshot {
  try {
    return { readable: true, item: readSnapshot(value) };
  } catch (e) {
    if (!(e instanceof z.ZodError)) throw e;
    console.error(`activity snapshot unreadable for entry ${entryId}`);
    return { readable: false };
  }
}

function currentItem(agg: TripAggregate, id: string | null): Item | null {
  return id ? (agg.items.find((i) => i.id === id) ?? null) : null;
}

function mayEdit(agg: TripAggregate, requester: Requester, item: Item): boolean {
  try {
    assertCanEditItem(agg, requester, item);
    return true;
  } catch (e) {
    if (e instanceof AccessDenied) return false;
    throw e;
  }
}

async function actorNames(ctx: ServiceContext, ids: string[]): Promise<Map<string, string>> {
  if (ids.length === 0) return new Map();
  const rows = await ctx.db.select({ id: t.users.id, name: t.users.name, email: t.users.email }).from(t.users).where(inArray(t.users.id, ids));
  return new Map(rows.map((r) => [r.id, actorName(r.name, r.email)]));
}

function requireMember(agg: TripAggregate, requester: Requester): string {
  const member = requester.kind === "member" && agg.memberships.some((m) => m.userId === requester.userId);
  if (requester.kind !== "member" || !member) throw new AccessDenied();
  return requester.userId;
}

function undone(entry: StoredActivity, entries: StoredActivity[], names: Map<string, string>, me: string): { kind: ActivityKind; by: string } | null {
  const older = entries.slice(entries.indexOf(entry) + 1).find((x) => x.itemId === entry.itemId);
  if (!older) return null;
  return { kind: ACTIVITY_KIND.parse(older.action), by: older.actorId === me ? "You" : (names.get(older.actorId) ?? UNNAMED) };
}

export async function listActivityLines(ctx: ServiceContext, tripId: string, requester: Requester, opts: { limit?: number } = {}): Promise<{ lines: ActivityLine[]; more: boolean }> {
  const agg = await requireAggregate(ctx.db, tripId);
  const me = requireMember(agg, requester);
  const perms = permissionsFor(agg, requester);
  const entries = (await listActivity(ctx.db, tripId)).filter((e) => KINDS.includes(e.action));
  const names = await actorNames(ctx, [...new Set(entries.map((e) => e.actorId))]);
  const latestFor = new Map<string, string>();
  for (const e of entries) if (e.itemId && !latestFor.has(e.itemId)) latestFor.set(e.itemId, e.id);

  const judge = (e: StoredActivity): { before: Snapshot; after: Snapshot; ref: Item | null; visible: boolean } => {
    const before = readEntry(e.id, e.before);
    const after = readEntry(e.id, e.after);
    const now = currentItem(agg, e.itemId);
    const state = e.action === "deleted" ? (before.readable ? before.item : null) : after.readable ? (after.item ?? (before.readable ? before.item : null)) : null;
    const ref = state ?? now;
    if (!e.itemId || !ref) return { before, after, ref: null, visible: false };
    const thenVisible = state ? canSeeItem(state, requester) : true;
    const nowVisible = now ? canSeeItem(now, requester) : true;
    return { before, after, ref, visible: thenVisible && nowVisible };
  };

  const hiddenFromBatch = new Map<string, number>();
  for (const e of entries) {
    if (!e.itemId || !e.via.startsWith("import:") || !["created", "merged"].includes(e.action)) continue;
    if (!judge(e).visible) hiddenFromBatch.set(e.via, (hiddenFromBatch.get(e.via) ?? 0) + 1);
  }

  const ideaIds = [...new Set(entries.filter((e) => e.action.startsWith("idea_") && e.itemId).map((e) => e.itemId ?? ""))];
  const nowIdeas = new Map((ideaIds.length > 0 ? await ctx.db.select().from(t.ideas).where(inArray(t.ideas.id, ideaIds)) : []).map((row) => [row.id, row]));
  const lines: ActivityLine[] = [];
  for (const e of entries) {
    const kind = ACTIVITY_KIND.parse(e.action);
    const by = e.actorId === me ? "You" : (names.get(e.actorId) ?? UNNAMED);
    if (kind === "imported") {
      if (!perms.canEdit) continue;
      const payload = z.object({ count: z.number(), source: z.string() }).parse(e.after);
      const count = payload.count - (hiddenFromBatch.get(e.via) ?? 0);
      if (count <= 0) continue;
      lines.push({ id: e.id, at: e.at, kind, by, title: null, itemId: null, changed: [], via: null, count, source: SOURCE_WORDS[payload.source] ?? "somewhere else", canUndo: false, undid: null });
      continue;
    }
    if (kind.startsWith("idea_")) {
      const idea = IdeaActivity.parse(e.after);
      const current = nowIdeas.get(idea.ideaId);
      if (!canSeeIdea(idea, requester) || (current && !canSeeIdea({ visibility: current.visibility, createdBy: current.createdBy, visibleToUserIds: current.visibleToUserIds }, requester))) continue;
      lines.push({ id: e.id, at: e.at, kind, by, title: idea.title, itemId: null, changed: [], via: null, count: null, source: null, canUndo: false, undid: null });
      continue;
    }
    const { before, after, ref, visible } = judge(e);
    if (!visible || !ref) continue;
    const readable = before.readable && after.readable;
    const diff = readable ? changedFields(before.item, after.item, perms.canSeeSensitive, perms.canSeeDeadlines) : { names: [], onlyHidden: false };
    if (diff.onlyHidden) continue;
    const now = currentItem(agg, e.itemId);
    const beforeItem = before.readable ? before.item : null;
    const afterItem = after.readable ? after.item : null;
    const creatorRule = !(now && beforeItem && now.createdBy !== me && wouldChangeWhoSees(now, beforeItem));
    const undoable = readable && creatorRule && UNDOABLE.includes(kind) && perms.canEdit && e.itemId !== null && latestFor.get(e.itemId) === e.id && (now ? mayEdit(agg, requester, now) : afterItem === null && beforeItem !== null && canSeeItem(beforeItem, requester));
    lines.push({
      id: e.id,
      at: e.at,
      kind,
      by,
      title: ref.title,
      itemId: now && canSeeItem(now, requester) ? now.id : null,
      changed: diff.names,
      via: viaLabel(e.via),
      count: null,
      source: null,
      canUndo: undoable,
      undid: kind === "undone" ? undone(e, entries, names, me) : null,
    });
  }
  const limit = opts.limit ?? ACTIVITY_PAGE;
  return { lines: lines.slice(0, limit), more: lines.length > limit };
}

function dayKeyOf(item: Item): string {
  return localDateKey(item.start);
}

export interface UndoResult {
  kind: ActivityKind;
  title: string;
  itemId: string | null;
  dayKey: string | null;
  by: string;
}

export async function undoActivity(ctx: ServiceContext, tripId: string, requester: Requester, activityId: string): Promise<UndoResult> {
  const id = z.string().uuid().safeParse(activityId);
  const agg0 = await requireAggregate(ctx.db, tripId);
  const me = requireMember(agg0, requester);
  if (!permissionsFor(agg0, requester).canEdit) throw new AccessDenied("You cannot change this trip.");
  const result = await ctx.db.transaction(async (tx) => {
    const all = (await listActivity(tx, tripId)).filter((e) => KINDS.includes(e.action));
    const entry = id.success ? all.find((e) => e.id === id.data) : undefined;
    if (!entry || !entry.itemId || !UNDOABLE.includes(entry.action)) throw new UndoRefused("missing", NOT_AN_ENTRY, null);
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${entry.itemId}))`);
    await lockItemRow(tx, tripId, entry.itemId);
    const agg = await requireAggregate(tx, tripId);
    const fresh = (await listActivity(tx, tripId)).filter((e) => e.itemId === entry.itemId);
    const beforeRead = readEntry(entry.id, entry.before);
    const afterRead = readEntry(entry.id, entry.after);
    if (!beforeRead.readable || !afterRead.readable) throw new UndoRefused("missing", NOT_AN_ENTRY, null);
    const before = beforeRead.item;
    const after = afterRead.item;
    const title = (after ?? before)?.title ?? "That item";
    const now = currentItem(agg, entry.itemId);
    const judged = now ?? before ?? after;
    if (!judged || !canSeeItem(judged, requester)) throw new UndoRefused("missing", NOT_AN_ENTRY, null);
    if (fresh[0]?.id !== entry.id) throw new UndoRefused("changed", title, now ? now.id : null);
    if (now && !mayEdit(agg, requester, now)) throw new UndoRefused("cannot_edit", title, null);
    const target = before;
    if (now && target && now.createdBy !== me && wouldChangeWhoSees(now, target)) {
      throw new AccessDenied("Only the person who added this can change who sees it.");
    }
    try {
      if (target) await saveItem(tx, target);
      else await deleteItem(tx, tripId, entry.itemId);
    } catch (e) {
      if (e instanceof UnknownTraveler) throw new UndoRefused("changed", title, now ? now.id : null);
      throw e;
    }
    await touchTrip(tx, tripId);
    await insertActivity(tx, { tripId, actorId: me, action: "undone", itemId: entry.itemId, before: now, after: target });
    return { kind: ACTIVITY_KIND.parse(entry.action), title: target ? target.title : title, itemId: target ? target.id : null, dayKey: target ? dayKeyOf(target) : null, actorId: entry.actorId };
  });
  await ctx.onTripChanged(tripId);
  const who = (await actorNames(ctx, [result.actorId])).get(result.actorId) ?? UNNAMED;
  return { kind: result.kind, title: result.title, itemId: result.itemId, dayKey: result.dayKey, by: result.actorId === me ? "You" : who };
}
