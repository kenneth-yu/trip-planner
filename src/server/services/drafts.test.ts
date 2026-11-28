import { and, eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { z } from "zod";
import { TRIP_ID, USERS } from "@/fixtures/december-trip";
import * as t from "../db/schema";
import { FakeGoogleCalendar } from "../google/calendar-api";
import { createMcpServer } from "../mcp/server";
import { jacob, kenny, testContext } from "../testing";
import { createAssistantToken, resolveAssistantToken } from "./assistant-service";
import { listActivityLines } from "./activity-service";
import { enableMirror, syncTripMirrors } from "./mirror-service";
import { InputProblem } from "@/domain/import/quick-add";
import { getTripView, quickAddItem, updateItem } from "./trip-service";

const DRAFT = { type: "plan" as const, title: "Draft sushi dinner", city: "Tokyo", startLocal: "2026-12-04T19:00", endLocal: "2026-12-04T21:00" };

async function setup() {
  const google = new FakeGoogleCalendar();
  const env = await testContext({ withItems: false, overrides: { googleFor: async () => google } });
  env.ctx.onTripChanged = async (tripId) => {
    await syncTripMirrors(env.ctx, tripId);
  };
  const draft = await quickAddItem(env.ctx, TRIP_ID, kenny, DRAFT, { booked: false });
  return { ...env, google, draft };
}

const mirrored = (google: FakeGoogleCalendar) => [...[...google.calendars.values()][0].events.values()].map((e) => e.summary);

describe("a draft added by an editor", () => {
  it("is stored as not booked and seen by the people planning", async () => {
    const { ctx, draft } = await setup();
    expect(draft.booked).toBe(false);
    expect((await getTripView(ctx, TRIP_ID, kenny)).items.map((i) => i.title)).toContain(DRAFT.title);
    expect((await getTripView(ctx, TRIP_ID, jacob)).items.map((i) => i.title)).toContain(DRAFT.title);
  });

  it("is not seen by an invited viewer, nor in the activity they can read", async () => {
    const { ctx, db } = await setup();
    await db.update(t.memberships).set({ role: "viewer" }).where(and(eq(t.memberships.userId, USERS.jacob.id), eq(t.memberships.tripId, TRIP_ID)));
    expect((await getTripView(ctx, TRIP_ID, jacob)).items).toEqual([]);
    expect(JSON.stringify(await listActivityLines(ctx, TRIP_ID, jacob))).not.toContain(DRAFT.title);
  });

  it("is not in a viewer's activity for the time it was a draft, only from when it was marked booked", async () => {
    const { ctx, db, draft } = await setup();
    await db.update(t.memberships).set({ role: "viewer" }).where(and(eq(t.memberships.userId, USERS.jacob.id), eq(t.memberships.tripId, TRIP_ID)));
    const named = async (who: typeof kenny) => (await listActivityLines(ctx, TRIP_ID, who)).lines.filter((l) => JSON.stringify(l).includes(DRAFT.title));
    expect(await named(jacob)).toEqual([]);
    expect(await named(kenny)).toHaveLength(1);
    await updateItem(ctx, TRIP_ID, draft.id, kenny, { booked: true });
    expect(await named(kenny)).toHaveLength(2);
    expect(await named(jacob)).toHaveLength(1);
  });

  it("stays out of the Google Calendar, and goes in on the next sync after it is marked booked", async () => {
    const { ctx, google, draft } = await setup();
    await enableMirror(ctx, TRIP_ID, USERS.kenny.id);
    expect(mirrored(google)).not.toContain(DRAFT.title);
    await updateItem(ctx, TRIP_ID, draft.id, kenny, { booked: true });
    expect(mirrored(google)).toContain(DRAFT.title);
    await updateItem(ctx, TRIP_ID, draft.id, kenny, { booked: false });
    expect(mirrored(google)).not.toContain(DRAFT.title);
  });
});

describe("what an assistant is told", () => {
  const TextContent = z.array(z.object({ type: z.literal("text"), text: z.string() }));

  async function tripText(env: Awaited<ReturnType<typeof setup>>, userId: string) {
    const { token } = await createAssistantToken(env.ctx, userId, { label: "Claude" });
    const who = await resolveAssistantToken(env.ctx, token);
    if (!who) throw new Error("token rejected");
    const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
    await createMcpServer(env.ctx, who).connect(serverSide);
    const client = new Client({ name: "test", version: "1.0.0" });
    await client.connect(clientSide);
    return TextContent.parse((await client.callTool({ name: "get_trip", arguments: { trip_id: TRIP_ID } })).content)[0].text;
  }

  it("says an editor's draft is not booked", async () => {
    const env = await setup();
    const text = await tripText(env, USERS.kenny.id);
    const line = text.split("\n").find((l) => l.includes(DRAFT.title));
    expect(line).toContain("[booked: false]");
  });

  it("never mentions the draft to an assistant that belongs to a viewer", async () => {
    const env = await setup();
    await env.db.update(t.memberships).set({ role: "viewer" }).where(and(eq(t.memberships.userId, USERS.jacob.id), eq(t.memberships.tripId, TRIP_ID)));
    expect(await tripText(env, USERS.jacob.id)).not.toContain(DRAFT.title);
  });
});

describe("what a draft keeps, whoever sends it", () => {
  const BOOKED_ONLY = {
    confirmationCode: "ABC123",
    bookingReference: "REF9",
    price: { amount: "120.00", currency: "USD" },
    phone: "+1 555 010 0000",
    notes: "Window table",
    deadlines: [{ kind: "free_cancellation" as const, local: "2026-12-03T23:59" }],
  };

  it("adding a draft through the service drops codes, price and deadlines, and keeps notes and phone", async () => {
    const { ctx } = await setup();
    const item = await quickAddItem(ctx, TRIP_ID, kenny, { ...DRAFT, title: "Draft with extras", ...BOOKED_ONLY }, { booked: false });
    const row = item.private.find((r) => r.phone);
    expect(item.deadlines).toEqual([]);
    expect(item.private.some((r) => r.confirmationCode || r.bookingReference || r.price || r.seat)).toBe(false);
    expect(row).toMatchObject({ phone: "+1 555 010 0000" });
    expect(item.notes).toBe("Window table");
  });

  it("the stored copy has none of them either", async () => {
    const { ctx } = await setup();
    const item = await quickAddItem(ctx, TRIP_ID, kenny, { ...DRAFT, title: "Draft with extras", ...BOOKED_ONLY }, { booked: false });
    const stored = (await getTripView(ctx, TRIP_ID, kenny)).items.find((i) => i.id === item.id);
    expect(stored?.deadlines).toEqual([]);
    expect(JSON.stringify(stored)).not.toContain("ABC123");
  });

  it("switching a booked item to Not yet removes its stored code, price and deadlines", async () => {
    const { ctx } = await setup();
    const item = await quickAddItem(ctx, TRIP_ID, kenny, { ...DRAFT, title: "Booked first", ...BOOKED_ONLY });
    expect(item.deadlines.length).toBe(1);
    const after = await updateItem(ctx, TRIP_ID, item.id, kenny, { booked: false });
    expect(after.deadlines).toEqual([]);
    expect(JSON.stringify(after.private)).not.toContain("ABC123");
    expect(JSON.stringify(after.private)).toContain("+1 555 010 0000");
  });

  it("marking it booked again does not bring them back", async () => {
    const { ctx } = await setup();
    const item = await quickAddItem(ctx, TRIP_ID, kenny, { ...DRAFT, title: "Booked first", ...BOOKED_ONLY });
    await updateItem(ctx, TRIP_ID, item.id, kenny, { booked: false });
    const back = await updateItem(ctx, TRIP_ID, item.id, kenny, { booked: true });
    expect(back.deadlines).toEqual([]);
    expect(JSON.stringify(back.private)).not.toContain("ABC123");
  });
});

describe("who may turn a booked item into a draft", () => {
  it("only the person who added it, because it hides the item from viewers", async () => {
    const { ctx } = await setup();
    const item = await quickAddItem(ctx, TRIP_ID, kenny, { ...DRAFT, title: "Kenny's booking" });
    await expect(updateItem(ctx, TRIP_ID, item.id, jacob, { booked: false })).rejects.toThrow(InputProblem);
    expect((await getTripView(ctx, TRIP_ID, kenny)).items.find((i) => i.id === item.id)?.booked).toBe(true);
    await expect(updateItem(ctx, TRIP_ID, item.id, kenny, { booked: false })).resolves.toMatchObject({ booked: false });
  });

  it("anyone who can edit may mark a draft as booked", async () => {
    const { ctx, draft } = await setup();
    await expect(updateItem(ctx, TRIP_ID, draft.id, jacob, { booked: true })).resolves.toMatchObject({ booked: true });
  });
});
