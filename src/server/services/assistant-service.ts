import { and, desc, eq, isNull } from "drizzle-orm";
import * as t from "../db/schema";
import { generateToken, hashToken } from "../auth/tokens";
import type { ServiceContext } from "./context";
import { machine as tokenMachine, type AssistantTokenState } from "@/domain/state/assistant-token.machine";
import { canTransition, InvalidTransition, transition } from "@/domain/state/machine";

function tokenState(row: { revokedAt: Date | null }): AssistantTokenState {
  return row.revokedAt ? "Revoked" : "Active";
}

export type AssistantScope = "read" | "propose";

export interface AssistantIdentity {
  tokenId: string;
  userId: string;
  tripId: string | null;
  scope: AssistantScope;
  label: string;
  homeZone: string;
}

export async function createAssistantToken(
  ctx: ServiceContext,
  userId: string,
  opts: { label: string; tripId?: string | null; scope?: AssistantScope },
): Promise<{ id: string; token: string }> {
  if (opts.tripId) {
    const [m] = await ctx.db.select().from(t.memberships).where(and(eq(t.memberships.tripId, opts.tripId), eq(t.memberships.userId, userId)));
    if (!m) throw new Error("You are not on that trip.");
  }
  const token = generateToken("tpa");
  const id = ctx.newId();
  await ctx.db.insert(t.assistantTokens).values({
    id,
    userId,
    tripId: opts.tripId ?? null,
    label: opts.label.slice(0, 80) || "Assistant",
    tokenHash: hashToken(token),
    scope: opts.scope ?? "propose",
  });
  return { id, token };
}

export async function resolveAssistantToken(ctx: ServiceContext, token: string | null | undefined): Promise<AssistantIdentity | null> {
  if (!token || !token.startsWith("tpa_")) return null;
  const [row] = await ctx.db
    .select({ tok: t.assistantTokens, user: t.users })
    .from(t.assistantTokens)
    .innerJoin(t.users, eq(t.users.id, t.assistantTokens.userId))
    .where(eq(t.assistantTokens.tokenHash, hashToken(token)));
  if (!row || !canTransition(tokenMachine, tokenState(row.tok), "use")) return null;
  await ctx.db.update(t.assistantTokens).set({ lastUsedAt: ctx.now() }).where(eq(t.assistantTokens.id, row.tok.id));
  return {
    tokenId: row.tok.id,
    userId: row.tok.userId,
    tripId: row.tok.tripId,
    scope: row.tok.scope,
    label: row.tok.label,
    homeZone: row.user.homeZone,
  };
}

export async function listAssistantTokens(ctx: ServiceContext, userId: string) {
  return ctx.db
    .select({ id: t.assistantTokens.id, label: t.assistantTokens.label, tripId: t.assistantTokens.tripId, scope: t.assistantTokens.scope, createdAt: t.assistantTokens.createdAt, lastUsedAt: t.assistantTokens.lastUsedAt })
    .from(t.assistantTokens)
    .where(and(eq(t.assistantTokens.userId, userId), isNull(t.assistantTokens.revokedAt)))
    .orderBy(desc(t.assistantTokens.createdAt));
}

export async function revokeAssistantToken(ctx: ServiceContext, userId: string, tokenId: string) {
  const [row] = await ctx.db.select().from(t.assistantTokens).where(and(eq(t.assistantTokens.id, tokenId), eq(t.assistantTokens.userId, userId)));
  if (!row) return;
  transition(tokenMachine, tokenState(row), "revoke");
  const revoked = await ctx.db
    .update(t.assistantTokens)
    .set({ revokedAt: ctx.now() })
    .where(and(eq(t.assistantTokens.id, tokenId), isNull(t.assistantTokens.revokedAt)))
    .returning({ id: t.assistantTokens.id });
  if (revoked.length === 0) throw new InvalidTransition(tokenMachine.name, "Revoked", "revoke");
}
