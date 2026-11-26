import * as t from "./db/schema";
import type { Db } from "./db/client";
import { saveItem } from "./repo/trip-repo";
import { generateToken, hashToken } from "./auth/tokens";
import { buildFixtureTrip, TRIP_ID, USERS } from "@/fixtures/december-trip";

export interface SeedResult {
  tripId: string;
  viewLinkToken: string;
}

export async function seedFixtureTrip(db: Db, opts: { withItems?: boolean } = {}): Promise<SeedResult> {
  const agg = buildFixtureTrip();
  const viewLinkToken = generateToken("tpv");
  await db.transaction(async (tx) => {
    await tx.insert(t.users).values(Object.values(USERS).map((u) => ({ ...u }))).onConflictDoNothing();
    await tx.insert(t.trips).values({ id: TRIP_ID, name: agg.trip.name, ownerId: agg.trip.ownerId, viewersSeeDeadlines: agg.trip.viewersSeeDeadlines });
    await tx.insert(t.memberships).values(agg.memberships);
    await tx.insert(t.travelers).values(agg.travelers);
    await tx.insert(t.shareLinks).values({ tripId: TRIP_ID, tokenHash: hashToken(viewLinkToken), enabled: true, showsDeadlines: false });
    if (opts.withItems !== false) for (const item of agg.items) await saveItem(tx, item);
  });
  return { tripId: TRIP_ID, viewLinkToken };
}
