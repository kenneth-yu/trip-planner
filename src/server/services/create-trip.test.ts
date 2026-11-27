import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { USERS } from "@/fixtures/december-trip";
import { InputProblem } from "@/domain/import/quick-add";
import * as t from "../db/schema";
import { jacob, kenny, testContext } from "../testing";
import { createTrip, getTripView, idempotentItemId, quickAddItem } from "./trip-service";

const viewer = { kind: "member" as const, userId: "00000000-0000-4000-8100-0000000000aa", homeZone: "America/New_York" };

describe("create trip", () => {
  it("makes the creator the owner and the first traveler, with the name trimmed", async () => {
    const { ctx, db } = await testContext({ withItems: false });
    const id = await createTrip(ctx, { id: USERS.jacob.id, name: USERS.jacob.name }, "  Lisbon in March  ");
    const [trip] = await db.select().from(t.trips).where(eq(t.trips.id, id));
    expect(trip.name).toBe("Lisbon in March");
    expect(await db.select().from(t.memberships).where(eq(t.memberships.tripId, id))).toMatchObject([{ userId: USERS.jacob.id, role: "owner" }]);
    expect(await db.select().from(t.travelers).where(eq(t.travelers.tripId, id))).toMatchObject([{ name: USERS.jacob.name, userId: USERS.jacob.id }]);
  });

  it("requires a name", async () => {
    const { ctx, db } = await testContext({ withItems: false });
    const before = (await db.select().from(t.trips)).length;
    await expect(createTrip(ctx, { id: USERS.kenny.id, name: USERS.kenny.name }, "   ")).rejects.toThrow(InputProblem);
    expect((await db.select().from(t.trips)).length).toBe(before);
  });

  it("starts empty and lets the owner add a flight", async () => {
    const { ctx } = await testContext({ withItems: false });
    const id = await createTrip(ctx, { id: USERS.kenny.id, name: USERS.kenny.name }, "Chicago weekend");
    expect((await getTripView(ctx, id, kenny)).items).toEqual([]);
    const item = await quickAddItem(ctx, id, kenny, { type: "flight", flightNumber: "UA 1", fromAirport: "JFK", toAirport: "ORD", departLocal: "2027-04-16T08:00", arriveLocal: "2027-04-16T09:40" });
    expect(item.travelerIds).toHaveLength(1);
  });

  it("does not let a viewer or a link visitor quick add", async () => {
    const { ctx, db, tripId } = await testContext({ withItems: false });
    await db.insert(t.users).values({ id: viewer.userId, name: "Casey Park", email: "casey@example.com" });
    await db.insert(t.memberships).values({ tripId, userId: viewer.userId, role: "viewer" });
    const input = { type: "plan", title: "Dinner", city: "Tokyo", startLocal: "2026-12-03T19:00", endLocal: "2026-12-03T20:00" };
    await expect(quickAddItem(ctx, tripId, viewer, input)).rejects.toThrow(/cannot change/);
    await expect(quickAddItem(ctx, tripId, { kind: "link", homeZone: "America/New_York" }, input)).rejects.toThrow();
    expect((await getTripView(ctx, tripId, kenny)).items).toEqual([]);
  });
});

describe("quick add submitted twice", () => {
  const input = { type: "plan", title: "Dinner", city: "Tokyo", startLocal: "2026-12-03T19:00", endLocal: "2026-12-03T20:00" };
  const key = "7d0a3a56-3f0b-4f4e-9f57-5f7d0c9a0b11";

  it("creates one item when two identical submissions race", async () => {
    const { ctx, tripId, changed } = await testContext({ withItems: false });
    const [a, b] = await Promise.all([
      quickAddItem(ctx, tripId, kenny, input, {}, { idempotencyKey: key }),
      quickAddItem(ctx, tripId, kenny, input, {}, { idempotencyKey: key }),
    ]);
    expect(a.id).toBe(b.id);
    expect((await getTripView(ctx, tripId, kenny)).items).toHaveLength(1);
    expect(changed).toHaveLength(1);
  });

  it("returns the same item when the submission is repeated later", async () => {
    const { ctx, db, tripId } = await testContext({ withItems: false });
    const first = await quickAddItem(ctx, tripId, kenny, input, {}, { idempotencyKey: key });
    const again = await quickAddItem(ctx, tripId, kenny, input, {}, { idempotencyKey: key });
    expect(again.id).toBe(first.id);
    expect(await db.select().from(t.activity)).toHaveLength(1);
  });

  it("keeps different submissions, different people and no key separate", async () => {
    const { ctx, tripId } = await testContext({ withItems: false });
    await quickAddItem(ctx, tripId, kenny, input, {}, { idempotencyKey: key });
    await quickAddItem(ctx, tripId, kenny, input, {}, { idempotencyKey: "9e5b3b0a-6a4c-4c53-8a5e-0b8a1f6d2c22" });
    await quickAddItem(ctx, tripId, jacob, input, {}, { idempotencyKey: key });
    await quickAddItem(ctx, tripId, kenny, input);
    await quickAddItem(ctx, tripId, kenny, input);
    expect((await getTripView(ctx, tripId, kenny)).items).toHaveLength(5);
  });

  it("derives an id that is a uuid and depends on person, trip and key", () => {
    const id = idempotentItemId("u1", "t1", key);
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(idempotentItemId("u2", "t1", key)).not.toBe(id);
    expect(idempotentItemId("u1", "t2", key)).not.toBe(id);
    expect(idempotentItemId("u1", "t1", key)).toBe(id);
  });
});
