import { describe, expect, it } from "vitest";
import { createPgliteDb } from "./db/client";
import * as t from "./db/schema";
import { assertSeedAllowed, SeedRefused, seedEverything } from "./seed";
import { USERS } from "@/fixtures/december-trip";

describe("seeding demo data", () => {
  it("refuses on a production deployment before touching the database", async () => {
    const db = await createPgliteDb();
    await expect(seedEverything(db, { VERCEL_ENV: "production" })).rejects.toThrow(SeedRefused);
    expect(await db.select().from(t.trips)).toEqual([]);
    expect(await db.select().from(t.users)).toEqual([]);
  });

  it("refuses with NODE_ENV=production", async () => {
    const db = await createPgliteDb();
    await expect(seedEverything(db, { NODE_ENV: "production" })).rejects.toThrow(SeedRefused);
    expect(await db.select().from(t.users)).toEqual([]);
  });

  it("refuses a laptop shell pointed at a remote database", async () => {
    const db = await createPgliteDb();
    const env = { DATABASE_URL: "postgres://u:p@ep-cool.neon.tech/trips" };
    expect(() => assertSeedAllowed(env)).toThrow(SeedRefused);
    await expect(seedEverything(db, env)).rejects.toThrow(SeedRefused);
    expect(await db.select().from(t.users)).toEqual([]);
  });

  it("allows a remote database only on a preview deployment or with the preview flag", () => {
    const remote = { DATABASE_URL: "postgres://u:p@ep-cool.neon.tech/trips" };
    expect(() => assertSeedAllowed({ ...remote, VERCEL_ENV: "preview" })).not.toThrow();
    expect(() => assertSeedAllowed(remote, true)).not.toThrow();
    expect(() => assertSeedAllowed({ ...remote, NODE_ENV: "production" }, true)).toThrow(SeedRefused);
    expect(() => assertSeedAllowed({ DATABASE_URL: "postgres://u:p@localhost:5432/trips" })).not.toThrow();
  });

  it("seeds an empty database on a preview deployment", async () => {
    const db = await createPgliteDb();
    const { created } = await seedEverything(db, { VERCEL_ENV: "preview" });
    expect(created.length).toBeGreaterThan(0);
  });

  it("is safe to run twice on demo data", async () => {
    const db = await createPgliteDb();
    await seedEverything(db, {});
    const second = await seedEverything(db, {});
    expect(second.created).toEqual([]);
  });

  it("refuses when the database already holds a trip that is not demo data", async () => {
    const db = await createPgliteDb();
    await db.insert(t.users).values({ ...USERS.kenny });
    await db.insert(t.trips).values({ name: "Our real trip", ownerId: USERS.kenny.id });
    await expect(seedEverything(db, {})).rejects.toThrow(SeedRefused);
    const names = (await db.select({ name: t.trips.name }).from(t.trips)).map((row) => row.name);
    expect(names).toEqual(["Our real trip"]);
  });

  it("does not echo the names of stored trips when it refuses", async () => {
    const db = await createPgliteDb();
    await db.insert(t.users).values({ ...USERS.kenny });
    await db.insert(t.trips).values({ name: "Our real trip", ownerId: USERS.kenny.id });
    await expect(seedEverything(db, {})).rejects.not.toThrow(/Our real trip/);
  });
});
