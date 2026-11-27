import { describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { createPgliteDb } from "../db/client";
import { rateLimits } from "../db/schema";
import { RATE_RULES, consumeRateLimit, ruleForPath, type RateRule } from "./rate-limit";

const rule: RateRule = { name: "signIn", limit: 3, windowMs: 60_000 };
const t0 = new Date("2026-11-27T10:00:00.000Z");
const after = (ms: number) => new Date(t0.getTime() + ms);

describe("consumeRateLimit", () => {
  it("allows up to the limit and then blocks with a retry time", async () => {
    const db = await createPgliteDb();
    const results = [];
    for (let i = 0; i < 4; i++) results.push(await consumeRateLimit(db, rule, "203.0.113.7", t0));
    expect(results.map((r) => r.allowed)).toEqual([true, true, true, false]);
    expect(results[3].retryAfterS).toBeGreaterThan(0);
    expect(results[3].retryAfterS).toBeLessThanOrEqual(60);
  });

  it("starts a fresh window when the clock moves past it", async () => {
    const db = await createPgliteDb();
    for (let i = 0; i < 4; i++) await consumeRateLimit(db, rule, "203.0.113.7", t0);
    const blocked = await consumeRateLimit(db, rule, "203.0.113.7", after(30_000));
    expect(blocked.allowed).toBe(false);
    const reopened = await consumeRateLimit(db, rule, "203.0.113.7", after(61_000));
    expect(reopened.allowed).toBe(true);
  });

  it("keeps subjects and rules apart", async () => {
    const db = await createPgliteDb();
    for (let i = 0; i < 4; i++) await consumeRateLimit(db, rule, "203.0.113.7", t0);
    expect((await consumeRateLimit(db, rule, "203.0.113.8", t0)).allowed).toBe(true);
    expect((await consumeRateLimit(db, { ...rule, name: "viewLink" }, "203.0.113.7", t0)).allowed).toBe(true);
  });

  it("does not overshoot when consumes run at the same time", async () => {
    const db = await createPgliteDb();
    const results = await Promise.all(Array.from({ length: 12 }, () => consumeRateLimit(db, rule, "203.0.113.7", t0)));
    expect(results.filter((r) => r.allowed)).toHaveLength(3);
  });

  it("stores only a hash, never the subject", async () => {
    const db = await createPgliteDb();
    await consumeRateLimit(db, rule, "203.0.113.7", t0);
    await consumeRateLimit(db, rule, "kenny@example.test", t0);
    const rows = await db.select().from(rateLimits);
    expect(rows).toHaveLength(2);
    for (const row of rows) {
      expect(row.key).toMatch(/^[0-9a-f]{64}$/);
      expect(JSON.stringify(row)).not.toContain("203.0.113.7");
      expect(JSON.stringify(row)).not.toContain("kenny");
    }
  });

  it("prunes windows that expired long ago", async () => {
    const db = await createPgliteDb();
    await consumeRateLimit(db, rule, "198.51.100.1", t0);
    await consumeRateLimit(db, rule, "198.51.100.2", after(48 * 3_600_000));
    const rows = await db.select({ n: sql<number>`count(*)::int` }).from(rateLimits);
    expect(rows[0].n).toBe(1);
  });
});

describe("ruleForPath", () => {
  it.each<[string, RateRule["name"]]>([
    ["/api/auth/signin/google", "signIn"],
    ["/api/auth/callback/google", "signIn"],
    ["/api/auth/email", "signIn"],
    ["/invite/abc", "inviteAccept"],
    ["/v/abc", "viewLink"],
    ["/api/feed/abc.ics", "feed"],
    ["/api/mcp", "assistant"],
    ["/api/mcp/abc", "assistant"],
  ])("%s uses the %s rule", (path, name) => {
    expect(ruleForPath(path)).toEqual(RATE_RULES[name]);
  });

  it.each(["/", "/trips/abc", "/api/mcpx", "/vault", "/invited", "/api/auth/session"])("%s is not limited", (path) => {
    expect(ruleForPath(path)).toBeNull();
  });
});
