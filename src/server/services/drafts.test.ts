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

  it("is not in the activity of a viewer even after it is marked booked, for the time it was a draft", async () => {
    const { ctx, db, draft } = await setup();
    await db.update(t.memberships).set({ role: "viewer" }).where(and(eq(t.memberships.userId, USERS.jacob.id), eq(t.memberships.tripId, TRIP_ID)));
    await updateItem(ctx, TRIP_ID, draft.id, kenny, { booked: true });
    const lines = (await listActivityLines(ctx, TRIP_ID, jacob)).lines;
    expect(lines.filter((l) => JSON.stringify(l).includes(DRAFT.title)).length).toBeLessThan((await listActivityLines(ctx, TRIP_ID, kenny)).lines.filter((l) => JSON.stringify(l).includes(DRAFT.title)).length);
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
