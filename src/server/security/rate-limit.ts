import { lt, sql } from "drizzle-orm";
import { rateLimits } from "../db/schema";
import { hashToken } from "../auth/tokens";
import type { DbOrTx } from "../repo/trip-repo";

export interface RateRule {
  name: "signIn" | "inviteAccept" | "viewLink" | "feed" | "assistant";
  limit: number;
  windowMs: number;
}

const MINUTE = 60_000;
const PRUNE_AFTER_MS = 24 * 60 * MINUTE;

export const RATE_RULES: Record<RateRule["name"], RateRule> = {
  signIn: { name: "signIn", limit: 10, windowMs: 15 * MINUTE },
  inviteAccept: { name: "inviteAccept", limit: 20, windowMs: 15 * MINUTE },
  viewLink: { name: "viewLink", limit: 120, windowMs: MINUTE },
  feed: { name: "feed", limit: 60, windowMs: MINUTE },
  assistant: { name: "assistant", limit: 120, windowMs: MINUTE },
};

const PATH_RULES: ReadonlyArray<{ rule: RateRule["name"]; test: (path: string) => boolean }> = [
  { rule: "signIn", test: (p) => ["/api/auth/signin", "/api/auth/callback", "/api/auth/email"].some((s) => p === s || p.startsWith(`${s}/`)) },
  { rule: "inviteAccept", test: (p) => p.startsWith("/invite/") },
  { rule: "viewLink", test: (p) => p.startsWith("/v/") },
  { rule: "feed", test: (p) => p.startsWith("/api/feed/") },
  { rule: "assistant", test: (p) => p === "/api/mcp" || p.startsWith("/api/mcp/") },
];

export function ruleForPath(pathname: string): RateRule | null {
  const match = PATH_RULES.find((r) => r.test(pathname));
  return match ? RATE_RULES[match.rule] : null;
}

export async function consumeRateLimit(
  db: DbOrTx,
  rule: RateRule,
  subject: string,
  now: Date,
): Promise<{ allowed: boolean; retryAfterS: number }> {
  const windowStartMs = Math.floor(now.getTime() / rule.windowMs) * rule.windowMs;
  const windowStart = new Date(windowStartMs);
  const key = hashToken(`${rule.name}:${subject}`);
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
