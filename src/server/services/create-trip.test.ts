import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { USERS } from "@/fixtures/december-trip";
import { InputProblem } from "@/domain/import/quick-add";
import * as t from "../db/schema";
import { kenny, testContext } from "../testing";
import { createTrip, getTripView, quickAddItem } from "./trip-service";

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
