import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { TRIP_ID, USERS } from "@/fixtures/december-trip";
import type { Requester } from "@/domain/types";
import { present } from "@/testing/present";
import { tick } from "@/testing/clock";
import { jacob, kenny, testContext } from "@/server/testing";
import * as t from "@/server/db/schema";
import { insertActivity } from "@/server/repo/activity-repo";
import { listActivityLines } from "@/server/services/activity-service";
import { createTrip, getTripView, quickAddItem, removeItem, updateItem } from "@/server/services/trip-service";
import type { ServiceContext } from "@/server/services/context";
import ActivityPage from "./page";
import { undoAction } from "./actions";
import { noUndo } from "./undo-state";

const world = vi.hoisted(() => {
  const state: { ctx: ServiceContext | null; requester: Requester | null } = { ctx: null, requester: null };
  return state;
});

vi.mock("next/cache", () => ({ revalidatePath: () => undefined }));
vi.mock("@/server/web", () => ({
  loadTripPage: async (tripId: string) => {
    if (!world.ctx || !world.requester) throw new Error("no test context");
    const view = await getTripView(world.ctx, tripId, world.requester);
    return { ctx: world.ctx, requester: world.requester, view, user: { id: world.requester.kind === "member" ? world.requester.userId : "" } };
  },
}));

const NY = "America/New_York";
const viewer: Requester = { kind: "member", userId: "00000000-0000-4000-8100-0000000000aa", homeZone: NY };

async function html(tripId = TRIP_ID, search: Record<string, string> = {}): Promise<string> {
  return renderToStaticMarkup(await ActivityPage({ params: Promise.resolve({ tripId }), searchParams: Promise.resolve(search) }));
}

function form(fields: Record<string, string>) {
  const data = new FormData();
  for (const [key, value] of Object.entries(fields)) data.set(key, value);
  return data;
}

beforeEach(async () => {
  vi.stubEnv("SESSION_SECRET", "test-secret-test-secret-test-secret-0123");
  const env = await testContext();
  await env.db.insert(t.users).values({ id: viewer.kind === "member" ? viewer.userId : "", name: "Casey Park", email: "casey@example.test" });
  await env.db.insert(t.memberships).values({ tripId: TRIP_ID, userId: viewer.kind === "member" ? viewer.userId : "", role: "viewer" });
  world.ctx = env.ctx;
  world.requester = kenny;
});

const flightOf = async () => present((await getTripView(present(world.ctx), TRIP_ID, kenny)).items.find((i) => i.flight?.flightNumber === "CX509"));

describe("the activity page", () => {
  it("says nothing has changed on a new trip", async () => {
    const trip = await createTrip(present(world.ctx), { id: USERS.kenny.id, name: USERS.kenny.name }, "Lisbon, someday");
    expect(await html(trip)).toContain("Nothing has changed yet. Changes to this trip will show here.");
  });

  it("shows who changed what in plain words, with Undo named for its entry", async () => {
    const flight = await flightOf();
    tick();
    await updateItem(present(world.ctx), TRIP_ID, flight.id, kenny, { title: "CX509 to Hong Kong" });
    tick();
    await quickAddItem(present(world.ctx), TRIP_ID, jacob, { type: "plan", title: "Jantzen Tailor", city: "Hong Kong", startLocal: "2026-12-05T17:00", endLocal: "2026-12-05T18:30" });
    const page = await html();
    expect(page).toMatch(/<h2[^>]*>(Today|[A-Z][a-z]{2} [A-Z][a-z]{2} \d+)<\/h2>/);
    expect(page).toContain("You changed ");
    expect(page).toContain("CX509 to Hong Kong");
    expect(page).toContain("Jacob added ");
    expect(page).toContain("· title");
    expect(page).toContain('aria-label="Undo: You changed CX509 to Hong Kong"');
    expect(page).not.toContain("@");
    expect(page).not.toMatch(/<table|<svg/);
  });

  it("gives a viewer the entries without Undo, and leaves out a seat-only edit", async () => {
    const flight = await flightOf();
    tick();
    await updateItem(present(world.ctx), TRIP_ID, flight.id, kenny, { title: "CX509 to Hong Kong" });
    tick();
    await insertActivity(present(world.ctx).db, { tripId: TRIP_ID, actorId: USERS.jacob.id, action: "updated", itemId: flight.id, before: flight, after: { ...flight, private: [{ travelerId: null, seat: "ZQ98" }] } });
    world.requester = viewer;
    const page = await html();
    expect(page).toContain("Kenneth changed ");
    expect(page).not.toContain("Undo");
    expect(page).not.toMatch(/booking details|ZQ98|seat/i);
  });

  it("names a seat change as booking details to an editor and never shows the seat", async () => {
    const flight = await flightOf();
    tick();
    await insertActivity(present(world.ctx).db, { tripId: TRIP_ID, actorId: USERS.jacob.id, action: "updated", itemId: flight.id, before: flight, after: { ...flight, private: [{ travelerId: null, seat: "ZQ98" }] } });
    const page = await html();
    expect(page).toContain("booking details");
    expect(page).not.toMatch(/ZQ98|seat/i);
  });

  it("carries nothing about a hidden item for another person", async () => {
    tick();
    const secret = await quickAddItem(present(world.ctx), TRIP_ID, jacob, { type: "plan", title: "Ring shopping in Ginza", city: "Tokyo", startLocal: "2026-12-03T17:00", endLocal: "2026-12-03T18:00" }, { visibility: "only_me" });
    tick();
    await removeItem(present(world.ctx), TRIP_ID, secret.id, jacob);
    expect(await html()).not.toMatch(/Ring|Ginza/);
  });

  it("shows older entries with a Show older link, 50 at a time", async () => {
    const ctx = present(world.ctx);
    const flight = await flightOf();
    for (let i = 0; i < 55; i++) await insertActivity(ctx.db, { tripId: TRIP_ID, actorId: USERS.kenny.id, action: "updated", itemId: flight.id, before: flight, after: { ...flight, title: `T${i}` } });
    expect(await html()).toContain("Show older");
    expect(await html(TRIP_ID, { show: "100" })).not.toContain("Show older");
    expect(await html(TRIP_ID, { show: "<b>x</b>" })).toContain("Show older");
  });
});

describe("undo lines in the log", () => {
  it("name whose change was undone, what was brought back and what was removed", async () => {
    const ctx = present(world.ctx);
    const flight = await flightOf();
    tick();
    await updateItem(ctx, TRIP_ID, flight.id, jacob, { title: "Jacob's edit" });
    const edit = present((await listActivityLines(ctx, TRIP_ID, kenny)).lines.find((l) => l.kind === "updated"));
    tick();
    await undoAction(noUndo, form({ tripId: TRIP_ID, activityId: edit.id }));
    const stay = present((await getTripView(ctx, TRIP_ID, kenny)).items.find((i) => i.title === "Hotel Resol Ueno"));
    tick();
    await removeItem(ctx, TRIP_ID, stay.id, jacob);
    const gone = present((await listActivityLines(ctx, TRIP_ID, kenny)).lines.find((l) => l.kind === "deleted"));
    tick();
    await undoAction(noUndo, form({ tripId: TRIP_ID, activityId: gone.id }));
    tick();
    const added = await quickAddItem(ctx, TRIP_ID, jacob, { type: "plan", title: "Jantzen Tailor", city: "Hong Kong", startLocal: "2026-12-05T17:00", endLocal: "2026-12-05T18:30" });
    const made = present((await listActivityLines(ctx, TRIP_ID, kenny)).lines.find((l) => l.kind === "created" && l.itemId === added.id));
    tick();
    await undoAction(noUndo, form({ tripId: TRIP_ID, activityId: made.id }));
    const page = (await html()).replace(/<[^>]+>/g, "");
    expect(page).toContain("You undid Jacob&#x27;s change to");
    expect(page).toContain("You brought back Hotel Resol Ueno.");
    expect(page).toContain("You removed Jantzen Tailor, which Jacob added.");
  });
});

describe("undoing from the page", () => {
  it("puts the item back and says so", async () => {
    const ctx = present(world.ctx);
    const flight = await flightOf();
    tick();
    await updateItem(ctx, TRIP_ID, flight.id, kenny, { title: "CX509 to Hong Kong" });
    const entry = present((await listActivityLines(ctx, TRIP_ID, kenny)).lines.find((l) => l.kind === "updated"));
    tick();
    const state = await undoAction(noUndo, form({ tripId: TRIP_ID, activityId: entry.id }));
    expect(state.parts.map((p) => p.text).join("")).toBe(`${flight.title} is back to how it was before your change.`);
    expect((await flightOf()).title).toBe(flight.title);
  });

  it("links the day when a deleted item comes back", async () => {
    const ctx = present(world.ctx);
    const stay = present((await getTripView(ctx, TRIP_ID, kenny)).items.find((i) => i.title === "Hotel Resol Ueno"));
    tick();
    await removeItem(ctx, TRIP_ID, stay.id, kenny);
    const entry = present((await listActivityLines(ctx, TRIP_ID, kenny)).lines.find((l) => l.kind === "deleted"));
    tick();
    const state = await undoAction(noUndo, form({ tripId: TRIP_ID, activityId: entry.id }));
    expect(state.parts[0].text).toBe("Hotel Resol Ueno is back on ");
    expect(state.parts[1].href).toBe(`/trips/${TRIP_ID}?day=2026-12-02`);
  });

  it("says nothing was undone when it changed again, and links the item", async () => {
    const ctx = present(world.ctx);
    const flight = await flightOf();
    tick();
    await updateItem(ctx, TRIP_ID, flight.id, kenny, { title: "First" });
    const entry = present((await listActivityLines(ctx, TRIP_ID, kenny)).lines.find((l) => l.title === "First"));
    tick();
    await updateItem(ctx, TRIP_ID, flight.id, jacob, { title: "Second" });
    tick();
    const state = await undoAction(noUndo, form({ tripId: TRIP_ID, activityId: entry.id }));
    expect(state.parts.map((p) => p.text).join("")).toBe("First changed again since then, so nothing was undone. Open it to change it by hand.");
    expect(state.parts[0].href).toBe(`/trips/${TRIP_ID}/items/${flight.id}`);
  });

  it("tells a viewer they can no longer change this item and changes nothing", async () => {
    const ctx = present(world.ctx);
    const flight = await flightOf();
    tick();
    await updateItem(ctx, TRIP_ID, flight.id, kenny, { title: "CX509 to Hong Kong" });
    const entry = present((await listActivityLines(ctx, TRIP_ID, kenny)).lines.find((l) => l.kind === "updated"));
    world.requester = viewer;
    tick();
    const state = await undoAction(noUndo, form({ tripId: TRIP_ID, activityId: entry.id }));
    expect(state.parts.map((p) => p.text).join("")).toBe("You can no longer change this item.");
    expect((await flightOf()).title).toBe("CX509 to Hong Kong");
  });
});
