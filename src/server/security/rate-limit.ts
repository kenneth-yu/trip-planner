import { lt, sql } from "drizzle-orm";
import { rateLimits } from "../db/schema";
import { createHmac } from "node:crypto";
import { appSecret } from "../auth/tokens";
import type { DbOrTx } from "../repo/trip-repo";

export interface RateRule {
  name: "signIn" | "inviteAccept" | "inviteLookup" | "viewLink" | "feed" | "assistant" | "quickAdd" | "placeHint" | "dataExport";
  limit: number;
  windowMs: number;
}

const MINUTE = 60_000;
const PRUNE_AFTER_MS = 24 * 60 * MINUTE;

export const RATE_RULES: Record<RateRule["name"], RateRule> = {
  signIn: { name: "signIn", limit: 10, windowMs: 15 * MINUTE },
  inviteAccept: { name: "inviteAccept", limit: 20, windowMs: 15 * MINUTE },
  inviteLookup: { name: "inviteLookup", limit: 60, windowMs: 15 * MINUTE },
  viewLink: { name: "viewLink", limit: 120, windowMs: MINUTE },
  feed: { name: "feed", limit: 60, windowMs: MINUTE },
  assistant: { name: "assistant", limit: 120, windowMs: MINUTE },
  quickAdd: { name: "quickAdd", limit: 30, windowMs: MINUTE },
  placeHint: { name: "placeHint", limit: 60, windowMs: MINUTE },
  dataExport: { name: "dataExport", limit: 6, windowMs: 15 * MINUTE },
};

const INVITE_TOKEN_OPEN = /^\/invite\/(?!(?:accept|join|lost|problem)(?:\/|$))[^/]+\/?$/;

const REQUEST_RULES: ReadonlyArray<{ rule: RateRule["name"]; test: (method: string, path: string) => boolean }> = [
  { rule: "signIn", test: (_m, p) => ["/api/auth/signin", "/api/auth/callback", "/api/auth/email"].some((s) => p === s || p.startsWith(`${s}/`)) },
  { rule: "inviteAccept", test: (_m, p) => INVITE_TOKEN_OPEN.test(p) },
  { rule: "inviteLookup", test: (_m, p) => p === "/invite/join" || p === "/invite/accept" },
  { rule: "viewLink", test: (_m, p) => p.startsWith("/v/") },
  { rule: "feed", test: (_m, p) => p.startsWith("/api/feed/") },
  { rule: "assistant", test: (_m, p) => p === "/api/mcp" || p.startsWith("/api/mcp/") },
];

export function ruleForRequest(method: string, pathname: string): RateRule | null {
  const match = REQUEST_RULES.find((r) => r.test(method.toUpperCase(), pathname));
  return match ? RATE_RULES[match.rule] : null;
}

function rateLimitKey(rule: RateRule, subject: string): string {
  return createHmac("sha256", appSecret()).update(`ratelimit:${rule.name}:${subject}`).digest("hex");
}

export async function consumeRateLimit(
  db: DbOrTx,
  rule: RateRule,
  subject: string,
  now: Date,
): Promise<{ allowed: boolean; retryAfterS: number }> {
  const windowStartMs = Math.floor(now.getTime() / rule.windowMs) * rule.windowMs;
  const windowStart = new Date(windowStartMs);
  const key = rateLimitKey(rule, subject);
  const [row] = await db
    .insert(rateLimits)
    .values({ key, windowStart, count: 1 })
    .onConflictDoUpdate({
      target: rateLimits.key,
      set: {
        count: sql`CASE WHEN ${rateLimits.windowStart} < ${windowStart} THEN 1 ELSE ${rateLimits.count} + 1 END`,
        windowStart: sql`GREATEST(${rateLimits.windowStart}, ${windowStart})`,
      },
    })
    .returning({ count: rateLimits.count });
  if (row.count === 1) await db.delete(rateLimits).where(lt(rateLimits.windowStart, new Date(now.getTime() - PRUNE_AFTER_MS)));
  const allowed = row.count <= rule.limit;
  const retryAfterS = allowed ? 0 : Math.max(1, Math.ceil((windowStartMs + rule.windowMs - now.getTime()) / 1000));
  return { allowed, retryAfterS };
}
