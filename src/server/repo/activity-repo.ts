import { randomUUID } from "node:crypto";
import { desc, eq } from "drizzle-orm";
import * as t from "../db/schema";
import { openJson, SealError, sealJson } from "../crypto/sealed";
import { activityPayloadSchema, type ActivityPayload } from "../crypto/schemas";
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

export interface StoredActivity extends ActivityPayload {
  id: string;
  tripId: string;
  actorId: string;
  at: string;
  action: string;
  itemId: string | null;
  via: string;
}

export async function insertActivity(db: DbOrTx, entry: ActivityEntry): Promise<void> {
  const id = randomUUID();
  await db.insert(t.activity).values({
    id,
    tripId: entry.tripId,
    actorId: entry.actorId,
    action: entry.action,
    itemId: entry.itemId ?? null,
    via: entry.via ?? "app",
    sealed: sealJson({ before: entry.before ?? null, after: entry.after ?? null }, "activity", id),
  });
}

export async function listActivity(db: DbOrTx, tripId: string): Promise<StoredActivity[]> {
  const rows = await db.select().from(t.activity).where(eq(t.activity.tripId, tripId)).orderBy(desc(t.activity.at));
  return rows.map((row) => {
    if (row.sealed === null) throw new SealError("Activity has not been sealed yet.");
    const { before, after } = openJson(row.sealed, activityPayloadSchema, "activity", row.id);
    return {
      id: row.id,
      tripId: row.tripId,
      actorId: row.actorId,
      at: row.at.toISOString(),
      action: row.action,
      itemId: row.itemId,
      via: row.via,
      before: before ?? null,
      after: after ?? null,
    };
  });
}
