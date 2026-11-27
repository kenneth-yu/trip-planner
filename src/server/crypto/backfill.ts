import { eq, isNotNull, or } from "drizzle-orm";
import type { Db } from "../db/client";
import * as t from "../db/schema";
import { sealJson } from "./sealed";

export interface BackfillCounts {
  itemPrivate: number;
  activity: number;
  imported: number;
}

export async function sealLegacyRows(db: Db): Promise<BackfillCounts> {
  const itemPrivate = await db.transaction(async (tx) => {
    const rows = await tx.select({ id: t.itemPrivate.id, data: t.itemPrivate.data }).from(t.itemPrivate).where(isNotNull(t.itemPrivate.data));
    for (const row of rows) {
      await tx.update(t.itemPrivate).set({ sealed: sealJson(row.data, "item_private", row.id), data: null }).where(eq(t.itemPrivate.id, row.id));
    }
    return rows.length;
  });
  const activity = await db.transaction(async (tx) => {
    const rows = await tx
      .select({ id: t.activity.id, before: t.activity.before, after: t.activity.after })
      .from(t.activity)
      .where(or(isNotNull(t.activity.before), isNotNull(t.activity.after)));
    for (const row of rows) {
      await tx
        .update(t.activity)
        .set({ sealed: sealJson({ before: row.before ?? null, after: row.after ?? null }, "activity", row.id), before: null, after: null })
        .where(eq(t.activity.id, row.id));
    }
    return rows.length;
  });
  const imported = await db.transaction(async (tx) => {
    const rows = await tx
      .select({ id: t.importedItems.id, raw: t.importedItems.raw, proposed: t.importedItems.proposed })
      .from(t.importedItems)
      .where(or(isNotNull(t.importedItems.raw), isNotNull(t.importedItems.proposed)));
    for (const row of rows) {
      await tx
        .update(t.importedItems)
        .set({ sealed: sealJson({ raw: row.raw ?? [], proposed: row.proposed }, "import", row.id), raw: null, proposed: null })
        .where(eq(t.importedItems.id, row.id));
    }
    return rows.length;
  });
  return { itemPrivate, activity, imported };
}
