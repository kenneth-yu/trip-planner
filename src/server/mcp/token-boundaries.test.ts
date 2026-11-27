import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { describe, expect, it } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { TRIP_ID, USERS, fixtureUuid } from "@/fixtures/december-trip";
import { present } from "@/testing/present";
import * as t from "../db/schema";
import { saveItem } from "../repo/trip-repo";
import { buildFixtureTrip } from "@/fixtures/december-trip";
import { listInbox } from "../services/inbox-service";
import { createAssistantToken, resolveAssistantToken, revokeAssistantToken } from "../services/assistant-service";
import { kenny, testContext } from "../testing";
import { createMcpServer } from "./server";
import type { ServiceContext } from "../services/context";

const TextContent = z.array(z.object({ type: z.literal("text"), text: z.string() }));
const SECRET_TITLE = "Surprise dinner zz9";
const SECRET_CODE = "SECRETCODE-ZZ9";

async function connectWith(ctx: ServiceContext, token: string): Promise<Client> {
  const who = present(await resolveAssistantToken(ctx, token), "assistant identity");
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  await createMcpServer(ctx, who).connect(serverSide);
  const client = new Client({ name: "boundary-assistant", version: "1.0.0" });
  await client.connect(clientSide);
  return client;
}

async function setup() {
  const base = await testContext();
  const plan = present(buildFixtureTrip().items.find((i) => i.type === "plan"));
  await saveItem(base.db, {
    ...plan,
    id: fixtureUuid(4, 99),
    title: SECRET_TITLE,
    visibility: "only_me",
    createdBy: USERS.kenny.id,
    updatedBy: USERS.kenny.id,
    private: [{ travelerId: null, confirmationCode: SECRET_CODE }],
    deadlines: [],
  });
  return base;
}

async function call(client: Client, name: string, args: Record<string, unknown>) {
  const result = await client.callTool({ name, arguments: args });
  return { text: TextContent.parse(result.content).map((c) => c.text).join("\n"), isError: result.isError === true };
}

describe("assistant token boundaries", () => {
  it("a token limited to another trip cannot read this one", async () => {
    const { ctx, db } = await setup();
    const otherTrip = fixtureUuid(3, 77);
    await db.insert(t.trips).values({ id: otherTrip, name: "Other trip", ownerId: USERS.jacob.id });
    await db.insert(t.memberships).values({ tripId: otherTrip, userId: USERS.jacob.id, role: "owner" });
    const { token } = await createAssistantToken(ctx, USERS.jacob.id, { label: "Other", tripId: otherTrip });
    const out = await call(await connectWith(ctx, token), "get_trip", { trip_id: TRIP_ID });
    expect(out.isError).toBe(true);
    expect(out.text).not.toContain(SECRET_TITLE);
  });

  it("a read only token reads without leaks and cannot add to the inbox", async () => {
    const { ctx } = await setup();
    const { token } = await createAssistantToken(ctx, USERS.jacob.id, { label: "Reader", scope: "read" });
    const client = await connectWith(ctx, token);
    const read = await call(client, "get_trip", { trip_id: TRIP_ID });
    expect(read.text).not.toContain(SECRET_TITLE);
    expect(read.text).not.toContain(SECRET_CODE);
    const add = await call(client, "add_items", {
      trip_id: TRIP_ID,
      items: [{ type: "plan", title: "Dinner", city: "Tokyo", startLocal: "2026-12-05T19:00", endLocal: "2026-12-05T21:00" }],
    });
    expect(add.isError).toBe(true);
    expect(await listInbox(ctx, TRIP_ID, kenny)).toEqual([]);
  });

  it("a revoked token stops working", async () => {
    const { ctx } = await setup();
    const { id, token } = await createAssistantToken(ctx, USERS.jacob.id, { label: "Temporary" });
    expect(await resolveAssistantToken(ctx, token)).not.toBeNull();
    await revokeAssistantToken(ctx, USERS.jacob.id, id);
    expect(await resolveAssistantToken(ctx, token)).toBeNull();
  });

  it("the token of a removed member gets nothing from get_trip or the inbox tool", async () => {
    const { ctx, db } = await setup();
    const { token } = await createAssistantToken(ctx, USERS.jacob.id, { label: "Jacob's Claude" });
    const client = await connectWith(ctx, token);
    await db.delete(t.memberships).where(and(eq(t.memberships.tripId, TRIP_ID), eq(t.memberships.userId, USERS.jacob.id)));
    for (const name of ["get_trip", "list_review_inbox"]) {
      const out = await call(client, name, { trip_id: TRIP_ID });
      expect(out.isError).toBe(true);
      expect(out.text).not.toContain(SECRET_TITLE);
      expect(out.text).not.toContain(SECRET_CODE);
    }
  });

  it("every read tool keeps the owner's hidden plan out of a partner's output", async () => {
    const { ctx } = await setup();
    const { token } = await createAssistantToken(ctx, USERS.jacob.id, { label: "Jacob's Claude" });
    const client = await connectWith(ctx, token);
    for (const [name, args] of [["get_trip", { trip_id: TRIP_ID }], ["list_review_inbox", { trip_id: TRIP_ID }], ["list_trips", {}]] as const) {
      const out = await call(client, name, args);
      expect(out.text).not.toContain(SECRET_TITLE);
      expect(out.text).not.toContain(SECRET_CODE);
    }
  });
});
