import { createPgliteDb } from "./db/client";
import { defaultContext, type ServiceContext } from "./services/context";
import { seedFixtureTrip } from "./seed";
import { FIXTURE_TODAY, USERS } from "@/fixtures/december-trip";
import type { Requester } from "@/domain/types";

export const kenny: Requester = { kind: "member", userId: USERS.kenny.id, homeZone: USERS.kenny.homeZone };
export const jacob: Requester = { kind: "member", userId: USERS.jacob.id, homeZone: USERS.jacob.homeZone };

export async function testContext(opts: { withItems?: boolean; overrides?: Partial<Omit<ServiceContext, "db" | "onTripChanged">> } = {}) {
  const db = await createPgliteDb();
  const seeded = await seedFixtureTrip(db, { withItems: opts.withItems });
  const changed: string[] = [];
  const ctx = defaultContext(
    db,
    {
      onTripChanged: (tripId) => {
        changed.push(tripId);
      },
    },
    { now: () => new Date(FIXTURE_TODAY), appUrl: "https://trips.test", ...opts.overrides },
  );
  return { ctx, db, changed, ...seeded };
}
