import { describe, expect, it } from "vitest";
import { USERS } from "@/fixtures/december-trip";
import { createPgliteDb } from "../db/client";
import * as t from "../db/schema";
import { spendBudget, type Budget } from "./action-budget";

const budget: Budget = { name: "placeHint", limit: 3, windowMs: 60_000 };
const start = new Date("2026-11-27T12:00:10Z");

describe("per person action budget", () => {
  it("allows the limit and refuses the next one in the same window", async () => {
    const db = await createPgliteDb();
    const results: boolean[] = [];
    for (let i = 0; i < 5; i++) results.push(await spendBudget(db, budget, USERS.kenny.id, start));
    expect(results).toEqual([true, true, true, false, false]);
  });

  it("counts each person separately", async () => {
    const db = await createPgliteDb();
    for (let i = 0; i < 4; i++) await spendBudget(db, budget, USERS.kenny.id, start);
    expect(await spendBudget(db, budget, USERS.jacob.id, start)).toBe(true);
  });

  it("starts again in the next window", async () => {
    const db = await createPgliteDb();
    for (let i = 0; i < 4; i++) await spendBudget(db, budget, USERS.kenny.id, start);
    expect(await spendBudget(db, budget, USERS.kenny.id, new Date(start.getTime() + 60_000))).toBe(true);
  });

  it("keeps different budgets apart and stores no user id", async () => {
    const db = await createPgliteDb();
    for (let i = 0; i < 4; i++) await spendBudget(db, budget, USERS.kenny.id, start);
    expect(await spendBudget(db, { ...budget, name: "quickAdd" }, USERS.kenny.id, start)).toBe(true);
    const keys = (await db.select().from(t.rateLimits)).map((r) => r.key);
    expect(keys).toHaveLength(2);
    for (const key of keys) expect(key).not.toContain(USERS.kenny.id);
  });
});
