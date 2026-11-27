import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import * as t from "./db/schema";
import type { Db } from "./db/client";
import { looksLikeProduction } from "./env";
import { saveItem } from "./repo/trip-repo";
import { buildFixtureTrip, TRAVELERS, USERS } from "@/fixtures/december-trip";
import type { Item } from "@/domain/types";

export class ImportRefused extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ImportRefused";
  }
}

export interface ImportOptions {
  ownerEmail: string;
  allowProduction: boolean;
  env: Record<string, string | undefined>;
}

export interface ImportSummary {
  tripId: string;
  items: number;
  deadlines: number;
  travelers: number;
}

const DEMO_EMAILS = new Set<string>(Object.values(USERS).map((user) => user.email));
const DEMO_USER_IDS = new Set<string>(Object.values(USERS).map((user) => user.id));

export function assertImportAllowed(options: Pick<ImportOptions, "allowProduction" | "env">): void {
  if (looksLikeProduction(options.env) && !options.allowProduction) {
    throw new ImportRefused("This looks like a production environment or a remote database. Run again with --allow-production if you mean to import there.");
  }
}

function carriedOver(item: Item, tripId: string, ownerId: string, travelerIds: Map<string, string>, now: string): Item {
  const id = randomUUID();
  return {
    ...item,
    id,
    tripId,
    travelerIds: item.travelerIds.map((travelerId) => travelerIds.get(travelerId) ?? travelerId),
    private: [],
    deadlines: item.deadlines.map((d) => ({ ...d, id: randomUUID(), itemId: id, confirmedBy: ownerId })),
    createdBy: ownerId,
    updatedBy: ownerId,
    createdAt: now,
    updatedAt: now,
  };
}

export async function importDecemberTrip(db: Db, options: ImportOptions): Promise<ImportSummary> {
  assertImportAllowed(options);
  const email = options.ownerEmail.trim().toLowerCase();
  const [owner] = await db.select({ id: t.users.id, email: t.users.email }).from(t.users).where(eq(t.users.email, email));
  if (!owner) throw new ImportRefused("No account has that email. Sign in once with Google on the site, then run this again.");
  if (DEMO_EMAILS.has(owner.email) || DEMO_USER_IDS.has(owner.id)) {
    throw new ImportRefused("That account belongs to the demo data. Use the real account you signed in with.");
  }

  const source = buildFixtureTrip();
  const [existing] = await db
    .select({ id: t.trips.id })
    .from(t.trips)
    .where(and(eq(t.trips.ownerId, owner.id), eq(t.trips.name, source.trip.name)));
  if (existing) throw new ImportRefused("That account already owns this trip, so nothing was imported.");

  const tripId = randomUUID();
  const kennyId = randomUUID();
  const jacobId = randomUUID();
  const travelerIds = new Map<string, string>([
    [TRAVELERS.kenny, kennyId],
    [TRAVELERS.jacob, jacobId],
  ]);
  const now = new Date().toISOString();
  const items = source.items.map((item) => carriedOver(item, tripId, owner.id, travelerIds, now));

  await db.transaction(async (tx) => {
    await tx.insert(t.trips).values({ id: tripId, name: source.trip.name, ownerId: owner.id, viewersSeeDeadlines: false });
    await tx.insert(t.memberships).values({ tripId, userId: owner.id, role: "owner" });
    await tx.insert(t.travelers).values([
      { id: kennyId, tripId, name: "Kenny", userId: owner.id },
      { id: jacobId, tripId, name: "Jacob", userId: null },
    ]);
    for (const item of items) await saveItem(tx, item);
  });

  return { tripId, items: items.length, deadlines: items.reduce((sum, item) => sum + item.deadlines.length, 0), travelers: 2 };
}

export function formatImportSummary(summary: ImportSummary): string {
  return `Imported trip ${summary.tripId}: ${summary.items} items, ${summary.deadlines} deadlines, ${summary.travelers} travelers.\n`;
}
