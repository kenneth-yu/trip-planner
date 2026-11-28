import { beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { TRIP_ID, USERS } from "@/fixtures/december-trip";
import { AccessDenied } from "@/domain/visibility/project";
import { present } from "@/testing/present";
import type { Requester } from "@/domain/types";
import * as t from "../db/schema";
import { insertActivity } from "../repo/activity-repo";
import { jacob, kenny, testContext } from "../testing";
import { listActivityLines, undoActivity, UndoRefused } from "./activity-service";
import { getTripView, quickAddItem, removeItem, updateItem } from "./trip-service";

const NY = "America/New_York";
const viewer: Requester = { kind: "member", userId: "00000000-0000-4000-8100-0000000000aa", homeZone: NY };
const link: Requester = { kind: "link", homeZone: NY };
const stranger: Requester = { kind: "member", userId: "00000000-0000-4000-8100-0000000000ff", homeZone: NY };

beforeAll(() => {
  process.env.SESSION_SECRET = "test-secret-test-secret-test-secret-0123";
});

async function setup() {
  const env = await testContext();
  await env.db.insert(t.users).values({ id: viewer.kind === "member" ? viewer.userId : "", name: "Casey Park", email: "casey@example.test" });
  await env.db.insert(t.memberships).values({ tripId: TRIP_ID, userId: viewer.kind === "member" ? viewer.userId : "", role: "viewer" });
  const view = await getTripView(env.ctx, TRIP_ID, kenny);
  const flight = present(view.items.find((i) => i.flight?.flightNumber === "CX509"));
  const stay = present(view.items.find((i) => i.title === "Hotel Resol Ueno"));
  return { ...env, flight, stay };
}

const plan = { type: "plan", title: "Jantzen Tailor", city: "Hong Kong", startLocal: "2026-12-05T17:00", endLocal: "2026-12-05T18:30" } as const;

describe("activity lines", () => {
  it("names who did what, with You for the signed in person, newest first", async () => {
    const { ctx, flight } = await setup();
    await updateItem(ctx, TRIP_ID, flight.id, kenny, { title: "CX509 to Hong Kong" });
    await quickAddItem(ctx, TRIP_ID, jacob, plan);
    const { lines } = await listActivityLines(ctx, TRIP_ID, kenny);
    expect(lines.slice(0, 2).map((l) => [l.kind, l.by, l.title])).toEqual([
      ["created", "Jacob", "Jantzen Tailor"],
      ["updated", "You", "CX509 to Hong Kong"],
    ]);
    expect(lines[1].changed).toEqual(["title"]);
  });

  it("never shows Kenny anything about Jacob's only-me item, even after it changed or was deleted", async () => {
    const { ctx } = await setup();
    const secret = await quickAddItem(ctx, TRIP_ID, jacob, { ...plan, title: "Ring shopping in Ginza" }, { visibility: "only_me" });
    await updateItem(ctx, TRIP_ID, secret.id, jacob, { title: "Ring shopping" });
    await removeItem(ctx, TRIP_ID, secret.id, jacob);
    for (const who of [kenny, viewer]) {
      expect(JSON.stringify(await listActivityLines(ctx, TRIP_ID, who))).not.toMatch(/Ring shopping|Ginza/);
    }
    expect(JSON.stringify(await listActivityLines(ctx, TRIP_ID, jacob))).toContain("Ring shopping");
  });

  it("names private changes only as booking details to editors, and leaves them out for viewers", async () => {
    const { ctx, db, flight } = await setup();
    const before = flight;
    const after = { ...flight, private: [{ travelerId: null, seat: "30Z", confirmationCode: "PLACEHOLDER_Z" }] };
    await insertActivity(db, { tripId: TRIP_ID, actorId: USERS.jacob.id, action: "updated", itemId: flight.id, before, after });
    const editor = await listActivityLines(ctx, TRIP_ID, kenny);
    expect(editor.lines[0].changed).toEqual(["booking details"]);
    const guest = await listActivityLines(ctx, TRIP_ID, viewer);
    expect(guest.lines.some((l) => l.changed.includes("booking details"))).toBe(false);
    expect(guest.lines).toEqual([]);
    for (const out of [editor, guest]) expect(JSON.stringify(out)).not.toMatch(/30Z|PLACEHOLDER|seat|confirmation/i);
  });

  it("carries no email, user id, token or value in any line, for anyone", async () => {
    const { ctx, flight } = await setup();
    await updateItem(ctx, TRIP_ID, flight.id, kenny, { title: "CX509 to Hong Kong", notes: "Gate code NOTE_CANARY" });
    for (const who of [kenny, jacob, viewer]) {
      const out = JSON.stringify(await listActivityLines(ctx, TRIP_ID, who));
      for (const secret of [USERS.kenny.id, USERS.jacob.id, USERS.kenny.email, "NOTE_CANARY", "tpa_", "tpv_"]) expect(out).not.toContain(secret);
    }
  });

  it("refuses a view link and a non member, and shows a viewer no undo", async () => {
    const { ctx, flight } = await setup();
    await updateItem(ctx, TRIP_ID, flight.id, kenny, { title: "CX509 to Hong Kong" });
    await expect(listActivityLines(ctx, TRIP_ID, link)).rejects.toThrow(AccessDenied);
    await expect(listActivityLines(ctx, TRIP_ID, stranger)).rejects.toThrow(AccessDenied);
    expect((await listActivityLines(ctx, TRIP_ID, viewer)).lines.some((l) => l.canUndo)).toBe(false);
  });

  it("counts a batch only by what the viewer can see, and leaves it out when nothing is visible", async () => {
    const { ctx, db } = await setup();
    await insertActivity(db, { tripId: TRIP_ID, actorId: USERS.jacob.id, action: "imported", via: "import:b1", after: { batchId: "b1", count: 3, source: "google_calendar" } });
    const secret = await quickAddItem(ctx, TRIP_ID, jacob, { ...plan, title: "Hidden one" }, { visibility: "only_me" });
    await db.update(t.activity).set({ via: "import:b1" }).where(eq(t.activity.itemId, secret.id));
    const mine = (await listActivityLines(ctx, TRIP_ID, jacob)).lines.find((l) => l.kind === "imported");
    const theirs = (await listActivityLines(ctx, TRIP_ID, kenny)).lines.find((l) => l.kind === "imported");
    expect(mine?.count).toBe(3);
    expect(theirs?.count).toBe(2);
    expect((await listActivityLines(ctx, TRIP_ID, viewer)).lines.some((l) => l.kind === "imported")).toBe(false);
  });

  it("shows the newest fifty and says there is more", async () => {
    const { ctx, db, flight } = await setup();
    for (let i = 0; i < 55; i++) await insertActivity(db, { tripId: TRIP_ID, actorId: USERS.kenny.id, action: "updated", itemId: flight.id, before: flight, after: { ...flight, title: `T${i}` } });
    const page = await listActivityLines(ctx, TRIP_ID, kenny);
    expect(page.lines).toHaveLength(50);
    expect(page.more).toBe(true);
    expect((await listActivityLines(ctx, TRIP_ID, kenny, { limit: 100 })).more).toBe(false);
  });
});

describe("undo", () => {
  it("puts an edited item back and is itself undoable", async () => {
    const { ctx, flight } = await setup();
    await updateItem(ctx, TRIP_ID, flight.id, kenny, { title: "CX509 to Hong Kong" });
    const edit = present((await listActivityLines(ctx, TRIP_ID, kenny)).lines.find((l) => l.kind === "updated"));
    expect(edit.canUndo).toBe(true);
    await undoActivity(ctx, TRIP_ID, kenny, edit.id);
    expect(present((await getTripView(ctx, TRIP_ID, kenny)).items.find((i) => i.id === flight.id)).title).toBe(flight.title);
    const after = (await listActivityLines(ctx, TRIP_ID, kenny)).lines;
    expect(after[0]).toMatchObject({ kind: "undone", by: "You" });
    expect(after.find((l) => l.id === edit.id)?.canUndo).toBe(false);
    await undoActivity(ctx, TRIP_ID, kenny, after[0].id);
    expect(present((await getTripView(ctx, TRIP_ID, kenny)).items.find((i) => i.id === flight.id)).title).toBe("CX509 to Hong Kong");
  });

  it("brings a deleted item back with its private rows and deadlines", async () => {
    const { ctx, stay } = await setup();
    await removeItem(ctx, TRIP_ID, stay.id, jacob);
    expect((await getTripView(ctx, TRIP_ID, kenny)).items.some((i) => i.id === stay.id)).toBe(false);
    const gone = present((await listActivityLines(ctx, TRIP_ID, jacob)).lines.find((l) => l.kind === "deleted"));
    expect(gone).toMatchObject({ by: "You", itemId: null, canUndo: true });
    const result = await undoActivity(ctx, TRIP_ID, jacob, gone.id);
    expect(result).toMatchObject({ kind: "deleted", title: "Hotel Resol Ueno" });
    const back = present((await getTripView(ctx, TRIP_ID, kenny)).items.find((i) => i.id === stay.id));
    expect(back.deadlines).toHaveLength(stay.deadlines.length);
    expect(back.private).toEqual(stay.private);
  });

  it("removes an item that was added", async () => {
    const { ctx } = await setup();
    const added = await quickAddItem(ctx, TRIP_ID, jacob, plan);
    const entry = present((await listActivityLines(ctx, TRIP_ID, jacob)).lines.find((l) => l.kind === "created"));
    await undoActivity(ctx, TRIP_ID, jacob, entry.id);
    expect((await getTripView(ctx, TRIP_ID, kenny)).items.some((i) => i.id === added.id)).toBe(false);
  });

  it("restores the sealed before of a merge", async () => {
    const { ctx, db, flight } = await setup();
    await insertActivity(db, { tripId: TRIP_ID, actorId: USERS.kenny.id, action: "merged", itemId: flight.id, via: "import:b1", before: flight, after: { ...flight, title: "Merged title" } });
    await db.update(t.items).set({ title: "Merged title" }).where(eq(t.items.id, flight.id));
    const merged = present((await listActivityLines(ctx, TRIP_ID, kenny)).lines.find((l) => l.kind === "merged"));
    await undoActivity(ctx, TRIP_ID, kenny, merged.id);
    expect(present((await getTripView(ctx, TRIP_ID, kenny)).items.find((i) => i.id === flight.id)).title).toBe(flight.title);
  });

  it("is refused when the item changed since, and changes nothing", async () => {
    const { ctx, flight } = await setup();
    await updateItem(ctx, TRIP_ID, flight.id, kenny, { title: "First change" });
    const first = present((await listActivityLines(ctx, TRIP_ID, kenny)).lines.find((l) => l.title === "First change"));
    await updateItem(ctx, TRIP_ID, flight.id, jacob, { title: "Second change" });
    await expect(undoActivity(ctx, TRIP_ID, kenny, first.id)).rejects.toThrow(UndoRefused);
    expect(present((await getTripView(ctx, TRIP_ID, kenny)).items.find((i) => i.id === flight.id)).title).toBe("Second change");
    expect((await listActivityLines(ctx, TRIP_ID, kenny)).lines.find((l) => l.id === first.id)?.canUndo).toBe(false);
  });

  it("is refused for a viewer, a link, a non member and an item the person cannot see, with nothing changed", async () => {
    const { ctx, flight } = await setup();
    await updateItem(ctx, TRIP_ID, flight.id, kenny, { title: "CX509 to Hong Kong" });
    const entry = present((await listActivityLines(ctx, TRIP_ID, kenny)).lines.find((l) => l.kind === "updated"));
    for (const who of [viewer, link, stranger]) await expect(undoActivity(ctx, TRIP_ID, who, entry.id)).rejects.toThrow();
    const secret = await quickAddItem(ctx, TRIP_ID, jacob, { ...plan, title: "Surprise" }, { visibility: "only_me" });
    await updateItem(ctx, TRIP_ID, secret.id, jacob, { title: "Surprise 2" });
    const hidden = present((await listActivityLines(ctx, TRIP_ID, jacob)).lines.find((l) => l.kind === "updated" && l.title === "Surprise 2"));
    await expect(undoActivity(ctx, TRIP_ID, kenny, hidden.id)).rejects.toThrow();
    expect(present((await getTripView(ctx, TRIP_ID, kenny)).items.find((i) => i.id === flight.id)).title).toBe("CX509 to Hong Kong");
  });

  it("refuses an id that is not an entry of this trip with the same answer as a bad id", async () => {
    const { ctx } = await setup();
    const answers = new Set<string>();
    for (const id of ["not-an-id", "00000000-0000-4000-8100-0000000000fe"]) {
      try {
        await undoActivity(ctx, TRIP_ID, kenny, id);
        answers.add("allowed");
      } catch (e) {
        answers.add(e instanceof Error ? `${e.name}:${e.message}` : "?");
      }
    }
    expect(answers.size).toBe(1);
  });
});
