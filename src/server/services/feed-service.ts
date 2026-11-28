import { and, eq, isNull } from "drizzle-orm";
import { buildFeed } from "@/domain/feed/ics-writer";
import { InvalidTransition } from "@/domain/state/machine";
import type { Requester } from "@/domain/types";
import { AccessDenied, permissionsFor, projectTrip, type TripView } from "@/domain/visibility/project";
import { generateToken, hashToken } from "../auth/tokens";
import * as t from "../db/schema";
import type { ServiceContext } from "./context";
import { requireAggregate } from "./trip-service";

const TOKEN_SHAPE = /^tpf_[A-Za-z0-9_-]{43}$/;
const READ_TOUCH_MS = 5 * 60_000;

export interface FeedLinkStatus {
  madeAt: Date;
  lastReadAt: Date | null;
}

export class FeedLinkExists extends Error {
  constructor() {
    super("You already have a calendar link for this trip.");
    this.name = "FeedLinkExists";
  }
}

async function requireMember(ctx: ServiceContext, tripId: string, requester: Requester): Promise<string> {
  if (requester.kind !== "member") throw new AccessDenied();
  permissionsFor(await requireAggregate(ctx.db, tripId), requester);
  return requester.userId;
}

const active = (tripId: string, userId: string) => and(eq(t.calendarFeeds.tripId, tripId), eq(t.calendarFeeds.userId, userId), isNull(t.calendarFeeds.revokedAt));

function urlFor(ctx: ServiceContext, token: string): string {
  return `${ctx.appUrl}/api/feed/${token}.ics`;
}

export async function getFeedLink(ctx: ServiceContext, tripId: string, requester: Requester): Promise<FeedLinkStatus | null> {
  const userId = await requireMember(ctx, tripId, requester);
  const [row] = await ctx.db.select({ madeAt: t.calendarFeeds.createdAt, lastReadAt: t.calendarFeeds.lastReadAt }).from(t.calendarFeeds).where(active(tripId, userId));
  return row ?? null;
}

async function insertLink(ctx: ServiceContext, tripId: string, userId: string, replace: boolean): Promise<{ url: string }> {
  const token = generateToken("tpf");
  await ctx.db.transaction(async (tx) => {
    const current = await tx.select({ id: t.calendarFeeds.id }).from(t.calendarFeeds).where(active(tripId, userId));
    if (replace && current.length === 0) throw new InvalidTransition("calendar feed", "Off", "rotate");
    if (!replace && current.length > 0) throw new FeedLinkExists();
    if (current.length > 0) await tx.update(t.calendarFeeds).set({ revokedAt: ctx.now() }).where(active(tripId, userId));
    await tx.insert(t.calendarFeeds).values({ tripId, userId, tokenHash: hashToken(token), createdAt: ctx.now() });
  });
  return { url: urlFor(ctx, token) };
}

export async function makeFeedLink(ctx: ServiceContext, tripId: string, requester: Requester): Promise<{ url: string }> {
  return insertLink(ctx, tripId, await requireMember(ctx, tripId, requester), false);
}

export async function rotateFeedLink(ctx: ServiceContext, tripId: string, requester: Requester): Promise<{ url: string }> {
  return insertLink(ctx, tripId, await requireMember(ctx, tripId, requester), true);
}

export async function turnOffFeedLink(ctx: ServiceContext, tripId: string, requester: Requester): Promise<void> {
  const userId = await requireMember(ctx, tripId, requester);
  const revoked = await ctx.db.update(t.calendarFeeds).set({ revokedAt: ctx.now() }).where(active(tripId, userId)).returning({ id: t.calendarFeeds.id });
  if (revoked.length === 0) throw new InvalidTransition("calendar feed", "Off", "turn off");
}

export async function loadFeed(ctx: ServiceContext, token: string): Promise<string | null> {
  if (!TOKEN_SHAPE.test(token)) return null;
  const [feed] = await ctx.db
    .select({ id: t.calendarFeeds.id, tripId: t.calendarFeeds.tripId, userId: t.calendarFeeds.userId, lastReadAt: t.calendarFeeds.lastReadAt })
    .from(t.calendarFeeds)
    .where(and(eq(t.calendarFeeds.tokenHash, hashToken(token)), isNull(t.calendarFeeds.revokedAt)));
  if (!feed) return null;
  const [user] = await ctx.db.select({ homeZone: t.users.homeZone }).from(t.users).where(eq(t.users.id, feed.userId));
  if (!user) return null;
  const agg = await requireAggregate(ctx.db, feed.tripId);
  let view: TripView;
  try {
    view = projectTrip(agg, { kind: "member", userId: feed.userId, homeZone: user.homeZone });
  } catch (e) {
    if (e instanceof AccessDenied) return null;
    throw e;
  }
  const now = ctx.now();
  if (!feed.lastReadAt || now.getTime() - feed.lastReadAt.getTime() > READ_TOUCH_MS) {
    await ctx.db.update(t.calendarFeeds).set({ lastReadAt: now }).where(eq(t.calendarFeeds.id, feed.id));
  }
  return buildFeed(view, { appUrl: ctx.appUrl, generatedAt: now });
}
