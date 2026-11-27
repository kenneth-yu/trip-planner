import { createHash } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { createPgliteDb } from "../db/client";
import { rateLimits } from "../db/schema";
import { RATE_RULES, consumeRateLimit, ruleForRequest, type RateRule } from "./rate-limit";

beforeAll(() => {
  process.env.SESSION_SECRET = "test-secret-test-secret-test-secret-0123";
});

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

  it("keys with a secret so a leaked table cannot be matched against hashed addresses", async () => {
    const db = await createPgliteDb();
    await consumeRateLimit(db, rule, "203.0.113.7", t0);
    const plain = createHash("sha256").update("signIn:203.0.113.7").digest("hex");
    const [row] = await db.select().from(rateLimits);
    expect(row.key).not.toBe(plain);
  });

  it("prunes windows that expired long ago", async () => {
    const db = await createPgliteDb();
    await consumeRateLimit(db, rule, "198.51.100.1", t0);
    await consumeRateLimit(db, rule, "198.51.100.2", after(48 * 3_600_000));
    const rows = await db.select({ n: sql<number>`count(*)::int` }).from(rateLimits);
    expect(rows[0].n).toBe(1);
  });
});

describe("ruleForRequest", () => {
  it.each<[string, string, RateRule["name"]]>([
    ["GET", "/api/auth/signin/google", "signIn"],
    ["POST", "/api/auth/signin/email", "signIn"],
    ["GET", "/api/auth/callback/google", "signIn"],
    ["GET", "/api/auth/email", "signIn"],
    ["GET", "/invite/abc", "inviteAccept"],
    ["GET", "/v/abc", "viewLink"],
    ["GET", "/api/feed/abc.ics", "feed"],
    ["POST", "/api/mcp", "assistant"],
    ["GET", "/api/mcp/abc", "assistant"],
  ])("%s %s uses the %s rule", (method, path, name) => {
    expect(ruleForRequest(method, path)).toEqual(RATE_RULES[name]);
  });

  it.each<[string, string]>([
    ["GET", "/"],
    ["POST", "/"],
    ["POST", "/sign-in"],
    ["GET", "/sign-in"],
    ["POST", "/sign-in/x"],
    ["GET", "/trips/abc"],
    ["POST", "/trips/abc/add"],
    ["GET", "/api/mcpx"],
    ["GET", "/vault"],
    ["GET", "/invited"],
    ["GET", "/invite/accept"],
    ["GET", "/invite/join"],
    ["POST", "/invite/join"],
    ["GET", "/invite/lost"],
    ["GET", "/invite/problem/expired"],
    ["GET", "/invite/abc/def"],
    ["GET", "/api/auth/session"],
  ])("%s %s is not limited", (method, path) => {
    expect(ruleForRequest(method, path)).toBeNull();
  });
});

describe("per person action limits", () => {
  const kenny = "00000000-0000-4000-8000-00000000000k";

  it("refuses the 31st quick add in a minute and the 61st place hint, per person", async () => {
    const db = await createPgliteDb();
    const quick = [];
    for (let i = 0; i < 31; i++) quick.push((await consumeRateLimit(db, RATE_RULES.quickAdd, kenny, t0)).allowed);
    expect(quick.filter(Boolean)).toHaveLength(30);
    expect(quick[30]).toBe(false);
    expect((await consumeRateLimit(db, RATE_RULES.placeHint, kenny, t0)).allowed).toBe(true);
    expect((await consumeRateLimit(db, RATE_RULES.quickAdd, "someone-else", t0)).allowed).toBe(true);
    expect((await consumeRateLimit(db, RATE_RULES.quickAdd, kenny, after(60_000))).allowed).toBe(true);
    expect(RATE_RULES.placeHint.limit).toBe(60);
  });
});
