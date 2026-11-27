import { and, eq } from "drizzle-orm";
import { z } from "zod";
import * as t from "../db/schema";
import { generateToken, hashToken } from "../auth/tokens";
import { RATE_RULES, consumeRateLimit } from "../security/rate-limit";
import type { ServiceContext } from "./context";
import { requireAggregate } from "./trip-service";
import { machine as viewLinkMachine, type ViewLinkState } from "@/domain/state/view-link.machine";
import { InvalidTransition, transition } from "@/domain/state/machine";
import { AccessDenied, projectTrip, type TripView } from "@/domain/visibility/project";
import type { Requester, TripAggregate } from "@/domain/types";

const TOKEN_SHAPE = /^tpv_[A-Za-z0-9_-]{43}$/;
const Switch = z.boolean();

export interface ViewLinkSettings {
  enabled: boolean;
  showsDeadlines: boolean;
  viewersSeeDeadlines: boolean;
  hasViewers: boolean;
}

async function requireOwner(ctx: ServiceContext, tripId: string, requester: Requester): Promise<TripAggregate> {
  const agg = await requireAggregate(ctx.db, tripId);
  const owner = requester.kind === "member" && agg.memberships.some((m) => m.userId === requester.userId && m.role === "owner");
  if (!owner) throw new AccessDenied("Only the trip owner can do that.");
  return agg;
}

export async function getViewLinkSettings(ctx: ServiceContext, tripId: string, requester: Requester): Promise<ViewLinkSettings> {
  const agg = await requireOwner(ctx, tripId, requester);
  return {
    enabled: agg.shareLink?.enabled ?? false,
    showsDeadlines: agg.shareLink?.showsDeadlines ?? false,
    viewersSeeDeadlines: agg.trip.viewersSeeDeadlines,
    hasViewers: agg.memberships.some((m) => m.role === "viewer"),
  };
}

function urlFor(ctx: ServiceContext, token: string): string {
  return `${ctx.appUrl}/v/${token}`;
}

export async function enableViewLink(ctx: ServiceContext, tripId: string, requester: Requester): Promise<{ url: string }> {
  const agg = await requireOwner(ctx, tripId, requester);
  const state: ViewLinkState = agg.shareLink?.enabled ? "On" : "Off";
  transition(viewLinkMachine, state, "enable");
  const token = generateToken("tpv");
  const rows = await ctx.db
    .insert(t.shareLinks)
    .values({ tripId, tokenHash: hashToken(token), enabled: true, showsDeadlines: false })
    .onConflictDoUpdate({ target: t.shareLinks.tripId, set: { tokenHash: hashToken(token), enabled: true, showsDeadlines: false, rotatedAt: ctx.now() }, setWhere: eq(t.shareLinks.enabled, false) })
    .returning({ tripId: t.shareLinks.tripId });
  if (rows.length === 0) throw new InvalidTransition(viewLinkMachine.name, "On", "enable");
  return { url: urlFor(ctx, token) };
}

export async function rotateViewLink(ctx: ServiceContext, tripId: string, requester: Requester): Promise<{ url: string }> {
  const agg = await requireOwner(ctx, tripId, requester);
  transition(viewLinkMachine, agg.shareLink?.enabled ? "On" : "Off", "rotate");
  const token = generateToken("tpv");
  const rows = await ctx.db
    .update(t.shareLinks)
    .set({ tokenHash: hashToken(token), rotatedAt: ctx.now() })
    .where(and(eq(t.shareLinks.tripId, tripId), eq(t.shareLinks.enabled, true)))
    .returning({ tripId: t.shareLinks.tripId });
  if (rows.length === 0) throw new InvalidTransition(viewLinkMachine.name, "Off", "rotate");
  return { url: urlFor(ctx, token) };
}

export async function disableViewLink(ctx: ServiceContext, tripId: string, requester: Requester): Promise<void> {
  const agg = await requireOwner(ctx, tripId, requester);
  transition(viewLinkMachine, agg.shareLink?.enabled ? "On" : "Off", "disable");
  await ctx.db.update(t.shareLinks).set({ enabled: false }).where(and(eq(t.shareLinks.tripId, tripId), eq(t.shareLinks.enabled, true)));
}

export async function setLinkShowsDeadlines(ctx: ServiceContext, tripId: string, requester: Requester, on: unknown): Promise<void> {
  const value = Switch.parse(on);
  const agg = await requireOwner(ctx, tripId, requester);
  if (!agg.shareLink?.enabled) throw new InvalidTransition(viewLinkMachine.name, "Off", "deadlines");
  await ctx.db.update(t.shareLinks).set({ showsDeadlines: value }).where(and(eq(t.shareLinks.tripId, tripId), eq(t.shareLinks.enabled, true)));
}

export async function setViewersSeeDeadlines(ctx: ServiceContext, tripId: string, requester: Requester, on: unknown): Promise<void> {
  const value = Switch.parse(on);
  await requireOwner(ctx, tripId, requester);
  await ctx.db.update(t.trips).set({ viewersSeeDeadlines: value }).where(eq(t.trips.id, tripId));
}

export async function resolveViewLink(ctx: ServiceContext, token: string): Promise<string | null> {
  if (!TOKEN_SHAPE.test(token)) return null;
  const [row] = await ctx.db
    .select({ tripId: t.shareLinks.tripId })
    .from(t.shareLinks)
    .where(and(eq(t.shareLinks.tokenHash, hashToken(token)), eq(t.shareLinks.enabled, true)));
  return row?.tripId ?? null;
}

export async function loadViewLinkTrip(ctx: ServiceContext, token: string, visitorZone: string): Promise<TripView | null> {
  const tripId = await resolveViewLink(ctx, token);
  if (!tripId) return null;
  const agg = await requireAggregate(ctx.db, tripId);
  try {
    return projectTrip(agg, { kind: "link", homeZone: visitorZone });
  } catch (e) {
    if (e instanceof AccessDenied) return null;
    throw e;
  }
}

export class LinkRateLimited extends Error {
  constructor() {
    super("Too many changes in a row. Wait a minute and try again.");
    this.name = "LinkRateLimited";
  }
}

export async function spendLinkBudget(ctx: ServiceContext, userId: string): Promise<void> {
  if (!(await consumeRateLimit(ctx.db, RATE_RULES.viewLinkChange, userId, ctx.now())).allowed) throw new LinkRateLimited();
}
