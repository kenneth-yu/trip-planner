import * as t from "../db/schema";
import type { DbOrTx } from "./trip-repo";

export interface ActivityEntry {
  tripId: string;
  actorId: string;
  action: string;
  itemId?: string | null;
  via?: string;
  before?: unknown;
  after?: unknown;
}

export async function insertActivity(db: DbOrTx, entry: ActivityEntry): Promise<void> {
  await db.insert(t.activity).values({
    tripId: entry.tripId,
    actorId: entry.actorId,
    action: entry.action,
    itemId: entry.itemId ?? null,
    via: entry.via ?? "app",
    before: entry.before ?? null,
    after: entry.after ?? null,
  });
}
