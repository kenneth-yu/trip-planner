import { eq } from "drizzle-orm";
import * as t from "./db/schema";
import type { Db } from "./db/client";
import { saveItem, type DbOrTx } from "./repo/trip-repo";
import { generateToken, hashToken } from "./auth/tokens";
import { buildFixtureTrip, TRIP_ID, USERS } from "@/fixtures/december-trip";
import { buildDemoTrip, DEMO_TRIPS } from "@/fixtures/demo-trips";
import type { TripAggregate } from "@/domain/types";

export interface SeedResult {
  tripId: string;
  viewLinkToken: string;
}

async function insertTrip(tx: DbOrTx, agg: TripAggregate, opts: { withItems: boolean; viewLinkToken: string | null }) {
  await tx.insert(t.users).values(Object.values(USERS).map((u) => ({ ...u }))).onConflictDoNothing();
  await tx.insert(t.trips).values({ id: agg.trip.id, name: agg.trip.name, ownerId: agg.trip.ownerId, viewersSeeDeadlines: agg.trip.viewersSeeDeadlines });
  await tx.insert(t.memberships).values(agg.memberships);
  if (agg.travelers.length) await tx.insert(t.travelers).values(agg.travelers);
  if (opts.viewLinkToken) await tx.insert(t.shareLinks).values({ tripId: agg.trip.id, tokenHash: hashToken(opts.viewLinkToken), enabled: true, showsDeadlines: false });
  if (opts.withItems) for (const item of agg.items) await saveItem(tx, item);
}

export async function seedFixtureTrip(db: Db, opts: { withItems?: boolean } = {}): Promise<SeedResult> {
  const viewLinkToken = generateToken("tpv");
  await db.transaction((tx) => insertTrip(tx, buildFixtureTrip(), { withItems: opts.withItems !== false, viewLinkToken }));
  return { tripId: TRIP_ID, viewLinkToken };
}

export class SeedRefused extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SeedRefused";
  }
}

async function assertOnlyDemoData(db: Db, demoTripIds: Set<string>, env: Record<string, string | undefined>): Promise<void> {
  if (env.VERCEL_ENV === "production") {
    throw new SeedRefused("Demo data is never loaded into a production deployment.");
  }
  const existing = await db.select({ id: t.trips.id }).from(t.trips);
  if (existing.some((row) => !demoTripIds.has(row.id))) {
    throw new SeedRefused("This database holds a trip that is not demo data, so it is not seeded. Point DATABASE_URL at the preview database.");
  }
}

export async function seedEverything(db: Db, env: Record<string, string | undefined> = process.env): Promise<{ created: string[]; skipped: string[] }> {
  const aggregates = [buildFixtureTrip(), ...DEMO_TRIPS.map(buildDemoTrip)];
  await assertOnlyDemoData(db, new Set(aggregates.map((agg) => agg.trip.id)), env);
  const created: string[] = [];
  const skipped: string[] = [];
  for (const agg of aggregates) {
    const [exists] = await db.select({ id: t.trips.id }).from(t.trips).where(eq(t.trips.id, agg.trip.id));
    if (exists) {
      skipped.push(agg.trip.name);
      continue;
    }
    await db.transaction((tx) => insertTrip(tx, agg, { withItems: true, viewLinkToken: agg.trip.id === TRIP_ID ? generateToken("tpv") : null }));
    created.push(agg.trip.name);
  }
  return { created, skipped };
}
