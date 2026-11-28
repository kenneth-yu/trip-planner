import { beforeAll, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { TRIP_ID, USERS } from "@/fixtures/december-trip";
import { present } from "@/testing/present";
import * as t from "../db/schema";
import { insertActivity } from "../repo/activity-repo";
import type { DbOrTx } from "../repo/trip-repo";
import { jacob, kenny, testContext } from "../testing";
import { listActivityLines, undoActivity } from "./activity-service";
import { getTripView, updateItem } from "./trip-service";

const race: { whileLocking: ((tx: DbOrTx) => Promise<void>) | null } = vi.hoisted(() => ({ whileLocking: null }));

vi.mock("../repo/trip-repo", async (original) => {
  const real = await original<typeof import("../repo/trip-repo")>();
  return {
    ...real,
    lockItemRow: async (db: Parameters<typeof real.lockItemRow>[0], tripId: string, itemId: string) => {
      const hook = race.whileLocking;
      race.whileLocking = null;
      if (hook) await hook(db);
      return real.lockItemRow(db, tripId, itemId);
    },
  };
});

beforeAll(() => {
  process.env.SESSION_SECRET = "test-secret-test-secret-test-secret-0123";
});

describe("undo takes the item row lock before it decides", () => {
  it("refuses when an edit committed while the undo waited for the lock, and changes nothing", async () => {
    const env = await testContext();
    const view = await getTripView(env.ctx, TRIP_ID, kenny);
    const flight = present(view.items.find((i) => i.flight?.flightNumber === "CX509"));
    await updateItem(env.ctx, TRIP_ID, flight.id, kenny, { title: "First change" });
    const first = present((await listActivityLines(env.ctx, TRIP_ID, kenny)).lines.find((l) => l.title === "First change"));
    race.whileLocking = async (tx) => {
      await tx.update(t.items).set({ title: "Racing edit" }).where(eq(t.items.id, flight.id));
      await insertActivity(tx, { tripId: TRIP_ID, actorId: USERS.jacob.id, action: "updated", itemId: flight.id, before: flight, after: { ...flight, title: "Racing edit" } });
    };
    await expect(undoActivity(env.ctx, TRIP_ID, kenny, first.id)).rejects.toMatchObject({ name: "UndoRefused", reason: "changed" });
    expect(race.whileLocking).toBeNull();
    expect(present((await getTripView(env.ctx, TRIP_ID, jacob)).items.find((i) => i.id === flight.id)).title).toBe("First change");
  });
});
