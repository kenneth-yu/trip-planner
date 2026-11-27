import fc from "fast-check";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { describe, expect, it } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { TRAVELERS, TRIP_ID, USERS, fixtureUuid } from "@/fixtures/december-trip";
import { fcParams, forbiddenStrings, itemsFor } from "@/testing/arbitraries";
import { present } from "@/testing/present";
import type { Requester } from "@/domain/types";
import * as t from "../db/schema";
import { loadTripAggregate, saveItem } from "../repo/trip-repo";
import { createAssistantToken, resolveAssistantToken } from "../services/assistant-service";
import { testContext } from "../testing";
import { createMcpServer } from "./server";
import type { ServiceContext } from "../services/context";

const VIEWER = { id: fixtureUuid(1, 3), name: "Mom Yu", email: "mom@example.com", homeZone: "America/New_York" };
const TextContent = z.array(z.object({ type: z.literal("text"), text: z.string() }));

async function connect(ctx: ServiceContext, userId: string): Promise<Client> {
  const { token } = await createAssistantToken(ctx, userId, { label: "Property assistant", tripId: TRIP_ID });
  const who = present(await resolveAssistantToken(ctx, token), "assistant identity");
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  await createMcpServer(ctx, who).connect(serverSide);
  const client = new Client({ name: "property-assistant", version: "1.0.0" });
  await client.connect(clientSide);
  return client;
}

describe("MCP get_trip properties", () => {
  it("returns no hidden item, no sensitive value and no blocked deadline to any member's assistant", async () => {
    const { ctx, db } = await testContext({ withItems: false });
    await db.insert(t.users).values(VIEWER);
    await db.insert(t.memberships).values({ tripId: TRIP_ID, userId: VIEWER.id, role: "viewer" });
    const people = [USERS.kenny.id, USERS.jacob.id, VIEWER.id];
    const clients = await Promise.all(people.map((id) => connect(ctx, id)));
    const itemsArb = itemsFor({ tripId: TRIP_ID, userIds: people, travelerIds: [TRAVELERS.kenny, TRAVELERS.jacob] });

    await fc.assert(
      fc.asyncProperty(itemsArb, fc.boolean(), async (items, viewersSeeDeadlines) => {
        await db.delete(t.items).where(eq(t.items.tripId, TRIP_ID));
        await db.update(t.trips).set({ viewersSeeDeadlines }).where(eq(t.trips.id, TRIP_ID));
        for (const item of items) await saveItem(db, item);
        const agg = present(await loadTripAggregate(db, TRIP_ID));
        for (const [i, userId] of people.entries()) {
          const requester: Requester = { kind: "member", userId, homeZone: "America/New_York" };
          const result = await present(clients[i]).callTool({ name: "get_trip", arguments: { trip_id: TRIP_ID } });
          const out = TextContent.parse(result.content).map((c) => c.text).join("\n");
          for (const forbidden of forbiddenStrings(agg, requester)) expect(out).not.toContain(forbidden);
          for (const item of agg.items) for (const p of item.private) for (const value of [p.confirmationCode, p.bookingReference, p.seat, p.phone, p.bookingSite, p.price?.amount]) if (value) expect(out).not.toContain(value);
        }
      }),
      fcParams(25),
    );
  }, 60_000);
});
