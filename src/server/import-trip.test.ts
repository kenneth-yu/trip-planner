import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { createPgliteDb, type Db } from "./db/client";
import * as t from "./db/schema";
import { ImportRefused, formatImportSummary, importDecemberTrip } from "./import-trip";
import { loadTripAggregate } from "./repo/trip-repo";
import { buildFixtureTrip, USERS } from "@/fixtures/december-trip";
import { projectTrip } from "@/domain/visibility/project";
import { present } from "@/testing/present";

const OWNER = { id: "11111111-1111-4111-8111-111111111111", name: "Real Person", email: "real.person@mail.test" };

async function dbWithOwner(): Promise<Db> {
  const db = await createPgliteDb();
  await db.insert(t.users).values(OWNER);
  return db;
}

async function refusal(run: Promise<unknown>): Promise<ImportRefused> {
  try {
    await run;
  } catch (e) {
    if (e instanceof ImportRefused) return e;
    throw e;
  }
  throw new Error("expected the import to be refused");
}

describe("importing the december trip into an owner's account", () => {
  it("creates the trip for the owner with Kenny linked and Jacob unlinked", async () => {
    const db = await dbWithOwner();
    const summary = await importDecemberTrip(db, { ownerEmail: "  Real.Person@Mail.test ", allowProduction: false, env: {} });
    const agg = present(await loadTripAggregate(db, summary.tripId));
    expect(agg.trip.name).toBe(buildFixtureTrip().trip.name);
    expect(agg.trip.ownerId).toBe(OWNER.id);
    expect(agg.memberships).toEqual([{ tripId: summary.tripId, userId: OWNER.id, role: "owner" }]);
    expect(agg.travelers.map((x) => [x.name, x.userId]).sort()).toEqual([
      ["Jacob", null],
      ["Kenny", OWNER.id],
    ]);
    expect(agg.items).toHaveLength(buildFixtureTrip().items.length);
    expect(summary.items).toBe(agg.items.length);
    expect(agg.items.every((item) => item.createdBy === OWNER.id && item.updatedBy === OWNER.id)).toBe(true);
  });

  it("links item travelers to the new traveler rows and keeps deadlines", async () => {
    const db = await dbWithOwner();
    const { tripId } = await importDecemberTrip(db, { ownerEmail: OWNER.email, allowProduction: false, env: {} });
    const agg = present(await loadTripAggregate(db, tripId));
    const travelerIds = new Set(agg.travelers.map((x) => x.id));
    expect(agg.items.every((item) => item.travelerIds.every((id) => travelerIds.has(id)))).toBe(true);
    const fixture = buildFixtureTrip();
    expect(agg.items.flatMap((item) => item.deadlines)).toHaveLength(fixture.items.flatMap((item) => item.deadlines).length);
    expect(agg.items.flatMap((item) => item.deadlines).every((d) => d.confirmedBy === OWNER.id)).toBe(true);
  });

  it("leaves no private rows, so no placeholder codes or seats", async () => {
    const db = await dbWithOwner();
    const { tripId } = await importDecemberTrip(db, { ownerEmail: OWNER.email, allowProduction: false, env: {} });
    expect(await db.select().from(t.itemPrivate)).toEqual([]);
    const agg = present(await loadTripAggregate(db, tripId));
    expect(agg.items.every((item) => item.private.length === 0)).toBe(true);
    const view = projectTrip(agg, { kind: "member", userId: OWNER.id, homeZone: "America/New_York" });
    expect(JSON.stringify(view)).not.toMatch(/PLACEHOLDER/);
  });

  it("does not touch ids of the fixture trip", async () => {
    const db = await dbWithOwner();
    const { tripId } = await importDecemberTrip(db, { ownerEmail: OWNER.email, allowProduction: false, env: {} });
    expect(tripId).not.toBe(buildFixtureTrip().trip.id);
    expect(await db.select().from(t.trips).where(eq(t.trips.id, buildFixtureTrip().trip.id))).toEqual([]);
  });

  it("refuses a second run for the same owner and adds nothing", async () => {
    const db = await dbWithOwner();
    await importDecemberTrip(db, { ownerEmail: OWNER.email, allowProduction: false, env: {} });
    await refusal(importDecemberTrip(db, { ownerEmail: OWNER.email, allowProduction: false, env: {} }));
    expect(await db.select().from(t.trips)).toHaveLength(1);
  });

  it("refuses when no user has that email, without echoing it", async () => {
    const db = await createPgliteDb();
    const e = await refusal(importDecemberTrip(db, { ownerEmail: "nobody@mail.test", allowProduction: false, env: {} }));
    expect(e.message).toMatch(/sign in once/i);
    expect(e.message).not.toContain("nobody@mail.test");
    expect(await db.select().from(t.trips)).toEqual([]);
  });

  it("refuses a fixture or demo user", async () => {
    const db = await createPgliteDb();
    await db.insert(t.users).values({ ...USERS.kenny });
    await refusal(importDecemberTrip(db, { ownerEmail: USERS.kenny.email, allowProduction: false, env: {} }));
    expect(await db.select().from(t.trips)).toEqual([]);
  });

  it.each([{ VERCEL_ENV: "production" }, { NODE_ENV: "production" }])("refuses %o without the production flag", async (env) => {
    const db = await dbWithOwner();
    await refusal(importDecemberTrip(db, { ownerEmail: OWNER.email, allowProduction: false, env }));
    expect(await db.select().from(t.trips)).toEqual([]);
  });

  it("refuses a laptop shell pointed at a remote database without the flag", async () => {
    const db = await dbWithOwner();
    const env = { DATABASE_URL: "postgres://u:p@ep-cool.neon.tech/trips" };
    expect((await refusal(importDecemberTrip(db, { ownerEmail: OWNER.email, allowProduction: false, env }))).message).not.toContain("neon.tech");
    expect(await db.select().from(t.trips)).toEqual([]);
    await importDecemberTrip(db, { ownerEmail: OWNER.email, allowProduction: true, env });
    expect(await db.select().from(t.trips)).toHaveLength(1);
  });

  it("allows a local database without the flag", async () => {
    const db = await dbWithOwner();
    await importDecemberTrip(db, { ownerEmail: OWNER.email, allowProduction: false, env: { DATABASE_URL: "postgres://u:p@localhost:5432/scratch" } });
    expect(await db.select().from(t.trips)).toHaveLength(1);
  });

  it("imports in production with the flag", async () => {
    const db = await dbWithOwner();
    await importDecemberTrip(db, { ownerEmail: OWNER.email, allowProduction: true, env: { VERCEL_ENV: "production" } });
    expect(await db.select().from(t.trips)).toHaveLength(1);
  });

  it("prints only counts and the trip id", async () => {
    const db = await dbWithOwner();
    const summary = await importDecemberTrip(db, { ownerEmail: OWNER.email, allowProduction: false, env: {} });
    const text = formatImportSummary(summary);
    expect(text).toContain(summary.tripId);
    for (const secret of [OWNER.email, OWNER.name, "Kenneth", "Jacob", "PLACEHOLDER", buildFixtureTrip().trip.name]) {
      expect(text).not.toContain(secret);
    }
  });
});
