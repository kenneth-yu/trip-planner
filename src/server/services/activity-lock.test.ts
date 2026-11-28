import { Pool } from "pg";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { TRIP_ID } from "@/fixtures/december-trip";
import { present } from "@/testing/present";
import { jacob, kenny, testContext } from "../testing";
import { listActivityLines, undoActivity } from "./activity-service";
import { getTripView, removeItem, updateItem } from "./trip-service";

interface Pause {
  reached: () => void;
  wait: Promise<void>;
}

const gate: { pause: Pause | null } = vi.hoisted(() => ({ pause: null }));

async function pauseOnce(): Promise<void> {
  const pause = gate.pause;
  gate.pause = null;
  if (pause) {
    pause.reached();
    await pause.wait;
  }
}

vi.mock("../repo/trip-repo", async (original) => {
  const real = await original<typeof import("../repo/trip-repo")>();
  return {
    ...real,
    saveItem: async (...args: Parameters<typeof real.saveItem>) => {
      await pauseOnce();
      return real.saveItem(...args);
    },
    deleteItem: async (...args: Parameters<typeof real.deleteItem>) => {
      await pauseOnce();
      return real.deleteItem(...args);
    },
  };
});

function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve: () => void = () => undefined;
  const promise = new Promise<void>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

const url = process.env.TEST_DATABASE_URL;

beforeAll(() => {
  process.env.SESSION_SECRET = "test-secret-test-secret-test-secret-0123";
});

async function blockedOnAnItemLock(observer: Pool): Promise<void> {
  for (let attempt = 0; attempt < 200; attempt++) {
    const result = await observer.query(
      "select count(*)::int as waiting from pg_locks l join pg_stat_activity a on a.pid = l.pid where not l.granted and a.datname = current_database() and a.query like '%for update%'",
    );
    if (result.rows[0].waiting > 0) return;
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error("The undo never blocked on the item lock.");
}

async function undoWaitsForTheWriter(write: (env: Awaited<ReturnType<typeof testContext>>, itemId: string) => Promise<unknown>) {
  const env = await testContext();
  const flight = present((await getTripView(env.ctx, TRIP_ID, kenny)).items.find((i) => i.flight?.flightNumber === "CX509"));
  await updateItem(env.ctx, TRIP_ID, flight.id, kenny, { title: "First change" });
  const first = present((await listActivityLines(env.ctx, TRIP_ID, kenny)).lines.find((l) => l.title === "First change"));

  const reached = deferred();
  const release = deferred();
  gate.pause = { reached: reached.resolve, wait: release.promise };
  const writer = write(env, flight.id);
  await reached.promise;

  let settled = false;
  const undo = undoActivity(env.ctx, TRIP_ID, kenny, first.id).then(
    (value) => {
      settled = true;
      return value;
    },
    (error: unknown) => {
      settled = true;
      return error;
    },
  );
  const observer = new Pool({ connectionString: url, max: 1 });
  try {
    await blockedOnAnItemLock(observer);
    expect(settled).toBe(false);
  } finally {
    release.resolve();
    await observer.end();
  }
  await writer;
  expect(await undo).toMatchObject({ name: "UndoRefused", reason: "changed" });
}

describe.skipIf(!url)("undo and edits exclude each other on a real database", () => {
  it("an undo started while an edit holds the item lock waits for it, then is refused as changed", async () => {
    await undoWaitsForTheWriter((env, itemId) => updateItem(env.ctx, TRIP_ID, itemId, jacob, { title: "Racing edit" }));
  });

  it("an undo started while a delete holds the item lock waits for it, then is refused as changed", async () => {
    await undoWaitsForTheWriter((env, itemId) => removeItem(env.ctx, TRIP_ID, itemId, jacob));
  });
});
