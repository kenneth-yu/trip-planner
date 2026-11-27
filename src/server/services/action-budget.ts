import { createHash } from "node:crypto";
import { sql } from "drizzle-orm";
import { rateLimits } from "../db/schema";
import type { DbOrTx } from "../repo/trip-repo";

export interface Budget {
  name: string;
  limit: number;
  windowMs: number;
}

export const PLACE_HINT_BUDGET: Budget = { name: "placeHint", limit: 60, windowMs: 60_000 };
export const QUICK_ADD_BUDGET: Budget = { name: "quickAdd", limit: 30, windowMs: 60_000 };

function budgetKey(budget: Budget, userId: string): string {
  return createHash("sha256").update(`budget:${budget.name}:${userId}`).digest("hex");
}

export async function spendBudget(db: DbOrTx, budget: Budget, userId: string, now: Date): Promise<boolean> {
  const windowStart = new Date(Math.floor(now.getTime() / budget.windowMs) * budget.windowMs);
  const [row] = await db
    .insert(rateLimits)
    .values({ key: budgetKey(budget, userId), windowStart, count: 1 })
    .onConflictDoUpdate({
      target: rateLimits.key,
      set: {
        count: sql`CASE WHEN ${rateLimits.windowStart} < ${windowStart} THEN 1 ELSE ${rateLimits.count} + 1 END`,
        windowStart: sql`GREATEST(${rateLimits.windowStart}, ${windowStart})`,
      },
    })
    .returning({ count: rateLimits.count });
  return row.count <= budget.limit;
}
