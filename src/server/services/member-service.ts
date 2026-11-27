import { createHmac } from "node:crypto";
import { and, asc, eq, ne, notInArray } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { z } from "zod";
import * as t from "../db/schema";
import { appSecret } from "../auth/tokens";
import { RATE_RULES, consumeRateLimit } from "../security/rate-limit";
import type { ServiceContext } from "./context";
import { requireAggregate } from "./trip-service";
import { InputProblem } from "@/domain/import/quick-add";
import { AccessDenied, permissionsFor } from "@/domain/visibility/project";
import type { Requester, Role } from "@/domain/types";

export interface TripMember {
  userId: string;
  name: string;
  role: Role;
}

export async function listTripMembers(ctx: ServiceContext, tripId: string, requester: Requester): Promise<TripMember[]> {
  if (requester.kind !== "member") throw new AccessDenied();
  const agg = await requireAggregate(ctx.db, tripId);
  permissionsFor(agg, requester);
  return ctx.db
    .select({ userId: t.users.id, name: t.users.name, role: t.memberships.role })
    .from(t.memberships)
    .innerJoin(t.users, eq(t.users.id, t.memberships.userId))
    .where(eq(t.memberships.tripId, tripId))
    .orderBy(asc(t.users.name));
}

export interface CoTraveler {
  id: string;
  name: string;
}

export class RateLimited extends Error {
  constructor() {
    super("Too many invites in a row. Wait a minute and try again.");
    this.name = "RateLimited";
  }
}

const NOT_ON_THE_LIST = "Pick someone from the list.";

function usableName(name: string, email: string): boolean {
  const local = email.split("@")[0]?.toLowerCase();
  return name.trim() !== "" && !name.includes("@") && name.toLowerCase() !== local;
}

function firstNameKey(name: string): string {
  return (name.trim().split(/\s+/)[0] ?? "").toLocaleLowerCase("en-US");
}

function tieBreak(id: string): string {
  return createHmac("sha256", appSecret()).update(`co-traveler-order:${id}`).digest("hex");
}

function compareText(a: string, b: string): number {
  return a.localeCompare(b, "en-US", { sensitivity: "base" });
}

async function requireOwnerMember(ctx: ServiceContext, tripId: string, requester: Requester): Promise<string> {
  const agg = await requireAggregate(ctx.db, tripId);
  const owner = requester.kind === "member" && agg.memberships.some((m) => m.userId === requester.userId && m.role === "owner");
  if (requester.kind !== "member" || !owner) throw new AccessDenied("Only the trip owner can do that.");
  return requester.userId;
}

async function coTravelersOf(ctx: ServiceContext, tripId: string, me: string): Promise<CoTraveler[]> {
  const mine = alias(t.memberships, "mine");
  const onThisTrip = ctx.db.select({ id: t.memberships.userId }).from(t.memberships).where(eq(t.memberships.tripId, tripId));
  const rows = await ctx.db
    .selectDistinct({ id: t.users.id, name: t.users.name, email: t.users.email })
    .from(mine)
    .innerJoin(t.memberships, eq(t.memberships.tripId, mine.tripId))
    .innerJoin(t.users, eq(t.users.id, t.memberships.userId))
    .where(and(eq(mine.userId, me), ne(t.memberships.userId, me), notInArray(t.users.id, onThisTrip)));
  return rows
    .filter((r) => usableName(r.name, r.email))
    .map((r) => ({ id: r.id, name: r.name, order: tieBreak(r.id) }))
    .sort((a, b) => compareText(firstNameKey(a.name), firstNameKey(b.name)) || compareText(a.name, b.name) || a.order.localeCompare(b.order))
    .map(({ id, name }) => ({ id, name }));
}

export async function spendInviteBudget(ctx: ServiceContext, userId: string): Promise<void> {
  if (!(await consumeRateLimit(ctx.db, RATE_RULES.inviteCreate, userId, ctx.now())).allowed) throw new RateLimited();
}

export async function listCoTravelers(ctx: ServiceContext, tripId: string, requester: Requester): Promise<CoTraveler[]> {
  const me = await requireOwnerMember(ctx, tripId, requester);
  await spendInviteBudget(ctx, me);
  return coTravelersOf(ctx, tripId, me);
}

export async function findCoTraveler(ctx: ServiceContext, tripId: string, requester: Requester, personId: unknown): Promise<CoTraveler> {
  const parsed = z.string().uuid().safeParse(personId);
  const me = await requireOwnerMember(ctx, tripId, requester);
  const found = parsed.success ? (await coTravelersOf(ctx, tripId, me)).find((p) => p.id === parsed.data) : undefined;
  if (!found) throw new InputProblem(NOT_ON_THE_LIST);
  return found;
}
