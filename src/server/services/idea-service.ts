import { and, eq, ne } from "drizzle-orm";
import { z } from "zod";
import { canSeeIdea, type Idea } from "@/domain/ideas/ideas";
import { InputProblem } from "@/domain/import/problem";
import { resolvePlace } from "@/domain/time/resolve-place";
import type { Item, Requester } from "@/domain/types";
import { AccessDenied, assertCanEditTrip, projectTrip } from "@/domain/visibility/project";
import { placeQueries } from "@/domain/import/quick-add";
import * as t from "../db/schema";
import type { ServiceContext } from "./context";
import { insertActivity } from "../repo/activity-repo";
import type { DbOrTx } from "../repo/trip-repo";
import { placeContextFor } from "./place-service";
import { NotFound, quickAddItem, requireAggregate } from "./trip-service";

const IdeaId = z.string().uuid();

const IdeaInput = z.object({
  title: z.string().trim().min(1).max(200),
  where: z.string().trim().max(300).optional(),
  note: z.string().trim().max(2000).optional(),
  visibility: z.enum(["everyone", "only_me", "specific"]).optional(),
  visibleToUserIds: z.array(z.string().uuid()).max(50).optional(),
});

export type IdeaInput = z.input<typeof IdeaInput>;

function toIdea(row: typeof t.ideas.$inferSelect): Idea {
  return {
    id: row.id,
    tripId: row.tripId,
    title: row.title,
    location: row.location ?? null,
    city: row.city,
    note: row.note,
    visibility: row.visibility,
    visibleToUserIds: row.visibleToUserIds,
    state: row.state,
    createdBy: row.createdBy,
    doneBy: row.doneBy,
    doneAt: row.doneAt ? row.doneAt.toISOString() : null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function memberId(requester: Requester): string {
  if (requester.kind !== "member") throw new AccessDenied();
  return requester.userId;
}

function placeOf(where: string | undefined): { city: string | null; location: Idea["location"] } {
  if (!where) return { city: null, location: null };
  const resolved = resolvePlace({ address: where });
  const city = resolved.status === "unknown" ? (where.includes(",") || /\d/.test(where) ? null : where) : resolved.city;
  const isCity = city !== null && city.toLowerCase() === where.toLowerCase();
  return { city, location: isCity ? null : { name: where, ...(city ? { city } : {}) } };
}

async function load(ctx: ServiceContext, tripId: string, ideaId: string, requester: Requester): Promise<Idea> {
  if (!IdeaId.safeParse(ideaId).success) throw new NotFound();
  const [row] = await ctx.db.select().from(t.ideas).where(and(eq(t.ideas.id, ideaId), eq(t.ideas.tripId, tripId)));
  const idea = row ? toIdea(row) : null;
  if (!idea || !canSeeIdea(idea, requester)) throw new NotFound("That idea does not exist, or you cannot see it.");
  return idea;
}

async function requireEditor(ctx: ServiceContext, tripId: string, requester: Requester): Promise<string> {
  const userId = memberId(requester);
  assertCanEditTrip(await requireAggregate(ctx.db, tripId), requester);
  return userId;
}

export async function listIdeas(ctx: ServiceContext, tripId: string, requester: Requester): Promise<Idea[]> {
  const agg = await requireAggregate(ctx.db, tripId);
  if (requester.kind !== "member" || !agg.memberships.some((m) => m.userId === requester.userId)) throw new AccessDenied();
  const rows = await ctx.db.select().from(t.ideas).where(and(eq(t.ideas.tripId, tripId), ne(t.ideas.state, "dropped")));
  return rows.map(toIdea).filter((idea) => canSeeIdea(idea, requester)).sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.title.localeCompare(b.title) || a.id.localeCompare(b.id));
}

async function sharingFor(ctx: ServiceContext, tripId: string, input: z.infer<typeof IdeaInput>): Promise<{ visibility: Idea["visibility"]; visibleToUserIds: string[] }> {
  const visibility = input.visibility ?? "everyone";
  if (visibility !== "specific") return { visibility, visibleToUserIds: [] };
  const members = new Set((await requireAggregate(ctx.db, tripId)).memberships.map((m) => m.userId));
  const chosen = [...new Set(input.visibleToUserIds ?? [])];
  if (chosen.some((id) => !members.has(id))) throw new InputProblem("Choose people who are on this trip.");
  return { visibility, visibleToUserIds: chosen };
}

function parse(input: unknown): z.infer<typeof IdeaInput> {
  const parsed = IdeaInput.safeParse(input);
  if (!parsed.success) throw new InputProblem("Say what the idea is, in 200 characters or fewer.");
  return parsed.data;
}

export async function createIdea(ctx: ServiceContext, tripId: string, requester: Requester, raw: unknown): Promise<Idea> {
  const userId = await requireEditor(ctx, tripId, requester);
  const input = parse(raw);
  const place = placeOf(input.where);
  const sharing = await sharingFor(ctx, tripId, input);
  const [row] = await ctx.db
    .insert(t.ideas)
    .values({ id: ctx.newId(), tripId, title: input.title, city: place.city, location: place.location, note: input.note ?? "", ...sharing, createdBy: userId, createdAt: ctx.now(), updatedAt: ctx.now() })
    .returning();
  if (!row) throw new Error("The idea was not saved.");
  return toIdea(row);
}

export async function editIdea(ctx: ServiceContext, tripId: string, ideaId: string, requester: Requester, raw: unknown): Promise<Idea> {
  const userId = await requireEditor(ctx, tripId, requester);
  const before = await load(ctx, tripId, ideaId, requester);
  const input = parse(raw);
  const changesSharing = input.visibility !== undefined || input.visibleToUserIds !== undefined;
  if (changesSharing && before.createdBy !== userId) throw new AccessDenied("Only the person who added this can change who sees it.");
  const place = input.where === undefined ? { city: before.city, location: before.location } : placeOf(input.where);
  const sharing = changesSharing ? await sharingFor(ctx, tripId, { ...input, visibility: input.visibility ?? before.visibility, visibleToUserIds: input.visibleToUserIds ?? before.visibleToUserIds }) : {};
  const [row] = await ctx.db
    .update(t.ideas)
    .set({ title: input.title, city: place.city, location: place.location, note: input.note ?? before.note, ...sharing, updatedAt: ctx.now() })
    .where(eq(t.ideas.id, ideaId))
    .returning();
  if (!row) throw new NotFound();
  return toIdea(row);
}

async function record(db: DbOrTx, tripId: string, actorId: string, action: "idea_scheduled" | "idea_done" | "idea_dropped" | "idea_reopened", idea: Idea): Promise<void> {
  await insertActivity(db, { tripId, actorId, action, itemId: idea.id, after: { ideaId: idea.id, title: idea.title, visibility: idea.visibility, createdBy: idea.createdBy, visibleToUserIds: idea.visibleToUserIds } });
}

async function move(ctx: ServiceContext, tripId: string, ideaId: string, requester: Requester, from: Idea["state"], to: Idea["state"], action: "idea_done" | "idea_dropped" | "idea_reopened"): Promise<Idea> {
  const userId = await requireEditor(ctx, tripId, requester);
  await load(ctx, tripId, ideaId, requester);
  const done = to === "done" ? { doneBy: userId, doneAt: ctx.now() } : { doneBy: null, doneAt: null };
  return ctx.db.transaction(async (tx) => {
    const [row] = await tx
      .update(t.ideas)
      .set({ state: to, ...done, updatedAt: ctx.now() })
      .where(and(eq(t.ideas.id, ideaId), eq(t.ideas.state, from)))
      .returning();
    if (!row) throw new InputProblem("That idea already changed. Reload the page.");
    const idea = toIdea(row);
    await record(tx, tripId, userId, action, idea);
    return idea;
  });
}

export const markIdeaDone = (ctx: ServiceContext, tripId: string, ideaId: string, requester: Requester) => move(ctx, tripId, ideaId, requester, "open", "done", "idea_done");
export const markIdeaNotDone = (ctx: ServiceContext, tripId: string, ideaId: string, requester: Requester) => move(ctx, tripId, ideaId, requester, "done", "open", "idea_reopened");
export const dropIdea = (ctx: ServiceContext, tripId: string, ideaId: string, requester: Requester) => move(ctx, tripId, ideaId, requester, "open", "dropped", "idea_dropped");
export const restoreIdea = (ctx: ServiceContext, tripId: string, ideaId: string, requester: Requester) => move(ctx, tripId, ideaId, requester, "dropped", "open", "idea_reopened");

export async function scheduleIdea(ctx: ServiceContext, tripId: string, ideaId: string, requester: Requester, plan: unknown): Promise<Item> {
  const userId = await requireEditor(ctx, tripId, requester);
  await load(ctx, tripId, ideaId, requester);
  const places = await placeContextFor(ctx, projectTrip(await requireAggregate(ctx.db, tripId), requester).items, requester.homeZone, placeQueries(plan));
  const item = await ctx.db.transaction(async (tx) => {
    const [row] = await tx.select().from(t.ideas).where(and(eq(t.ideas.id, ideaId), eq(t.ideas.tripId, tripId))).for("update");
    const idea = row ? toIdea(row) : null;
    if (!idea || !canSeeIdea(idea, requester) || idea.state !== "open") throw new InputProblem("That idea already changed. Reload the page.");
    const sharing = idea.visibility === "everyone" ? {} : { visibility: idea.visibility, visibleToUserIds: idea.visibility === "specific" && idea.createdBy ? [...new Set([...idea.visibleToUserIds, idea.createdBy])] : idea.visibleToUserIds };
    const created = await quickAddItem(ctx, tripId, requester, plan, sharing, { within: tx, places, idempotencyKey: `idea:${ideaId}` });
    await record(tx, tripId, userId, "idea_scheduled", idea);
    await tx.delete(t.ideas).where(eq(t.ideas.id, ideaId));
    return created;
  });
  await ctx.onTripChanged(tripId);
  return item;
}
