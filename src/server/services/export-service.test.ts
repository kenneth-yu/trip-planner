import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { TRIP_ID, USERS } from "@/fixtures/december-trip";
import { present } from "@/testing/present";
import * as t from "../db/schema";
import { hashToken } from "../auth/tokens";
import { jacob, kenny, testContext } from "../testing";
import { exportFileName, exportUserData } from "./export-service";
import { NotFound, quickAddItem } from "./trip-service";

const KENNY_ONLY = "Kenny only surprise dinner";
const JACOB_ONLY = "Ring shopping in Ginza";
const SPECIFIC = "Shared with Jacob only";

async function setup() {
  const world = await testContext();
  const { ctx, db } = world;
  const plan = (title: string) => ({ type: "plan", title, city: "Tokyo", startLocal: "2026-12-05T20:00", endLocal: "2026-12-05T21:00" });
  await quickAddItem(ctx, TRIP_ID, kenny, plan(KENNY_ONLY), { visibility: "only_me" });
  await quickAddItem(ctx, TRIP_ID, jacob, plan(JACOB_ONLY), { visibility: "only_me", showAsBusy: true });
  await quickAddItem(ctx, TRIP_ID, kenny, plan(SPECIFIC), { visibility: "specific", visibleToUserIds: [USERS.jacob.id] });
  await db.insert(t.assistantTokens).values({ userId: USERS.jacob.id, tripId: TRIP_ID, label: "trip", tokenHash: "TOKENHASH_CANARY_1" });
  await db.insert(t.invites).values({ tripId: TRIP_ID, role: "viewer", tokenHash: "INVITEHASH_CANARY_2", createdBy: USERS.kenny.id, expiresAt: new Date("2026-12-31") });
  return world;
}

async function exportText(world: Awaited<ReturnType<typeof setup>>, userId: string) {
  return JSON.stringify(await exportUserData(world.ctx, userId));
}

describe("exporting your data", () => {
  it("gives Jacob his own trips with his codes and no item hidden from him", async () => {
    const world = await setup();
    const text = await exportText(world, USERS.jacob.id);
    expect(text).toContain(JACOB_ONLY);
    expect(text).toContain(SPECIFIC);
    expect(text).not.toContain(KENNY_ONLY);
    expect(text).toContain("PLACEHOLDER");
  });

  it("gives Kenneth his own items and not the ones only Jacob can see", async () => {
    const world = await setup();
    const text = await exportText(world, USERS.kenny.id);
    expect(text).toContain(KENNY_ONLY);
    expect(text).not.toContain(JACOB_ONLY);
  });

  it("holds no other person's email, ids, hashes, tokens or link data", async () => {
    const world = await setup();
    const text = await exportText(world, USERS.kenny.id);
    expect(text).not.toContain(USERS.jacob.email);
    expect(text).not.toContain(USERS.jacob.id);
    expect(text).not.toContain("TOKENHASH_CANARY_1");
    expect(text).not.toContain(world.viewLinkToken);
    expect(text).not.toContain(hashToken(world.viewLinkToken));
    expect(text).not.toContain("visibleToUserIds");
    expect(text).not.toContain("tokenHash");
    expect(text).not.toContain("INVITEHASH_CANARY_2");
    expect(text).toContain(USERS.kenny.email);
  });

  it("lists the person, then their trips, in a readable key order with times and zones as stored", async () => {
    const world = await setup();
    const data = await exportUserData(world.ctx, USERS.kenny.id);
    expect(Object.keys(data)).toEqual(["exportedAt", "you", "trips"]);
    expect(Object.keys(data.you)).toEqual(["name", "email"]);
    expect(data.exportedAt).toBe(world.ctx.now().toISOString());
    const trip = present(data.trips[0]);
    expect(Object.keys(trip)).toEqual(["name", "role", "travelers", "items"]);
    expect(trip.role).toBe("owner");
    expect(trip.travelers).toEqual(expect.arrayContaining([USERS.kenny.name, USERS.jacob.name]));
    const first = present(trip.items[0]);
    expect(first.start.zone).toMatch(/\//);
    const starts = trip.items.map((i) => Date.parse(i.start.at));
    expect([...starts].sort((a, b) => a - b)).toEqual(starts);
  });

  it("leaves codes and seats out of a viewer's file", async () => {
    const world = await setup();
    await world.db.update(t.memberships).set({ role: "viewer" }).where(eq(t.memberships.userId, USERS.jacob.id));
    const text = await exportText(world, USERS.jacob.id);
    expect(text).not.toContain("PLACEHOLDER");
    expect(text).not.toContain('"seat"');
  });

  it("exports an empty trip with an empty items array", async () => {
    const world = await testContext({ withItems: false });
    const data = await exportUserData(world.ctx, USERS.kenny.id);
    expect(present(data.trips[0]).items).toEqual([]);
  });

  it("exports nothing for a trip the person left", async () => {
    const world = await setup();
    await world.db.delete(t.memberships).where(eq(t.memberships.userId, USERS.jacob.id));
    expect((await exportUserData(world.ctx, USERS.jacob.id)).trips).toEqual([]);
  });

  it("refuses an account that does not exist", async () => {
    const { ctx } = await testContext({ withItems: false });
    await expect(exportUserData(ctx, "00000000-0000-4000-8100-0000000000ff")).rejects.toThrow(NotFound);
  });

  it("names the file by date only", () => {
    expect(exportFileName(new Date("2026-11-27T23:30:00Z"))).toBe("trip-planner-export-2026-11-27.json");
  });
});
