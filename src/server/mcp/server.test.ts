import { z } from "zod";
import { describe, expect, it } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { fixture, TRIP_ID, USERS } from "@/fixtures/december-trip";
import { testContext, kenny } from "../testing";
import { createAssistantToken, resolveAssistantToken, revokeAssistantToken } from "../services/assistant-service";
import { getTripView } from "../services/trip-service";
import { listInbox } from "../services/inbox-service";
import { InvalidTransition } from "@/domain/state/machine";
import { createMcpServer } from "./server";
import type { ServiceContext } from "../services/context";

async function connect(ctx: ServiceContext, token: string) {
  const who = await resolveAssistantToken(ctx, token);
  if (!who) throw new Error("token rejected");
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  await createMcpServer(ctx, who).connect(serverSide);
  const client = new Client({ name: "test-assistant", version: "1.0.0" });
  await client.connect(clientSide);
  return client;
}

const TextContent = z.array(z.object({ type: z.literal("text"), text: z.string() }));
const textOf = (r: Awaited<ReturnType<Client["callTool"]>>) => TextContent.parse(r.content).map((c) => c.text).join("\n");

describe("MCP server for AI assistants", () => {
  it("lists its tools", async () => {
    const { ctx } = await testContext();
    const { token } = await createAssistantToken(ctx, USERS.jacob.id, { label: "Jacob's Claude" });
    const client = await connect(ctx, token);
    const tools = (await client.listTools()).tools.map((t) => t.name).sort();
    expect(tools).toEqual(["add_items", "get_trip", "import_calendar_events", "list_review_inbox", "list_trips"]);
  });

  it("get_trip reads the itinerary in local times, with deadlines and checks", async () => {
    const { ctx } = await testContext();
    const { token } = await createAssistantToken(ctx, USERS.jacob.id, { label: "Jacob's Claude" });
    const out = textOf(await (await connect(ctx, token)).callTool({ name: "get_trip", arguments: { trip_id: TRIP_ID } }));
    expect(out).toContain("12:55am NH159 ANA: New York, JFK to Tokyo, Haneda, lands 5:25am (Wed), 14h 30m");
    expect(out).toContain("Hotel Resol Ueno becomes non refundable in 2 days");
    expect(out).toContain("You land at Haneda on Dec 2 but fly out of Narita on Dec 5.");
  });

  it("add_items lands in the review inbox and never touches the trip", async () => {
    const { ctx, changed } = await testContext();
    const before = await getTripView(ctx, TRIP_ID, kenny);
    const { token } = await createAssistantToken(ctx, USERS.jacob.id, { label: "Jacob's Claude" });
    const result = await (await connect(ctx, token)).callTool({
      name: "add_items",
      arguments: {
        trip_id: TRIP_ID,
        items: [
          { type: "plan", title: "Dim sum at Tim Ho Wan", city: "Hong Kong", startLocal: "2026-12-11T11:00", endLocal: "2026-12-11T12:30", source: "Email from Tim Ho Wan" },
          { type: "flight", flightNumber: "XX1", fromAirport: "QQQ", toAirport: "HKG", departLocal: "2026-12-11T08:00", arriveLocal: "2026-12-11T10:00" },
        ],
      },
    });
    expect(textOf(result)).toBe('Sent 1 item to the review inbox.\nItem 2: We do not know the airport "QQQ". Check the code.');
    expect(await getTripView(ctx, TRIP_ID, kenny)).toEqual(before);
    expect(changed).toEqual([]);
    const inbox = await listInbox(ctx, TRIP_ID, kenny);
    expect(inbox.map((e) => [e.source, e.label, e.proposed.title])).toEqual([["assistant", "Jacob's Claude", "Dim sum at Tim Ho Wan"]]);
  });

  it("import_calendar_events takes raw events like Jacob's Gmail ones and proposes them", async () => {
    const { ctx } = await testContext({ withItems: false });
    const { token } = await createAssistantToken(ctx, USERS.jacob.id, { label: "Jacob's Claude" });
    const r = await (await connect(ctx, token)).callTool({ name: "import_calendar_events", arguments: { trip_id: TRIP_ID, events: fixture.calendarEvents.slice(0, 6) } });
    expect(textOf(r)).toBe("Sent 4 items to the review inbox.");
    const inbox = textOf(await (await connect(ctx, token)).callTool({ name: "list_review_inbox", arguments: { trip_id: TRIP_ID } }));
    expect(inbox).toContain("records disagree on start: 9:00am vs 8:50am");
  });

  it("rejects malformed input with a readable message", async () => {
    const { ctx } = await testContext();
    const { token } = await createAssistantToken(ctx, USERS.jacob.id, { label: "Jacob's Claude" });
    const r = await (await connect(ctx, token)).callTool({
      name: "add_items",
      arguments: { trip_id: TRIP_ID, items: [{ type: "plan", title: "Dinner", city: "Tokyo", startLocal: "Dec 5 7pm", endLocal: "2026-12-05T21:00" }] },
    });
    expect(r.isError).toBe(true);
    expect(textOf(r)).toMatch(/2026-12-05T08:50/);
  });

  it("read only tokens cannot propose, trip scoped tokens cannot see other trips, revoked tokens stop working", async () => {
    const { ctx } = await testContext();
    const ro = await createAssistantToken(ctx, USERS.jacob.id, { label: "Read only", scope: "read" });
    const r = await (await connect(ctx, ro.token)).callTool({ name: "add_items", arguments: { trip_id: TRIP_ID, items: [{ type: "plan", title: "x", city: "Tokyo", startLocal: "2026-12-05T19:00", endLocal: "2026-12-05T21:00" }] } });
    expect(textOf(r)).toBe("This assistant connection is read only.");

    const scoped = await createAssistantToken(ctx, USERS.jacob.id, { label: "Scoped", tripId: TRIP_ID });
    const other = await (await connect(ctx, scoped.token)).callTool({ name: "get_trip", arguments: { trip_id: "00000000-0000-4000-8900-000000000001" } });
    expect(textOf(other)).toBe("This assistant connection is limited to a different trip.");

    await revokeAssistantToken(ctx, USERS.jacob.id, scoped.id);
    expect(await resolveAssistantToken(ctx, scoped.token)).toBeNull();
    expect(await resolveAssistantToken(ctx, "tpa_not-a-real-token")).toBeNull();
  });

  it("a token can be revoked only once, by its owner, and a revoked token never resolves again", async () => {
    const { ctx } = await testContext();
    const { id, token } = await createAssistantToken(ctx, USERS.jacob.id, { label: "Jacob's Claude" });
    await revokeAssistantToken(ctx, USERS.kenny.id, id);
    expect(await resolveAssistantToken(ctx, token)).not.toBeNull();
    await revokeAssistantToken(ctx, USERS.jacob.id, id);
    await expect(revokeAssistantToken(ctx, USERS.jacob.id, id)).rejects.toThrow(InvalidTransition);
    expect(await resolveAssistantToken(ctx, token)).toBeNull();
  });
});
