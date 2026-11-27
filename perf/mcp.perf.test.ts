import { describe, expect, inject, it } from "vitest";
import { z } from "zod";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { TRIP_ID, USERS } from "@/fixtures/december-trip";
import { testContext } from "@/server/testing";
import { createAssistantToken, resolveAssistantToken } from "@/server/services/assistant-service";
import { createMcpServer } from "@/server/mcp/server";
import { budgets } from "./budgets";
import { check, measureAsync } from "./harness";

const SAMPLES = 31;
const WARMUP = 5;

function budgetFor(name: string): number {
  const entry = budgets.mcp[name];
  if (!entry) throw new Error(`Add "${name}" to mcp in perf/budgets.json with a measured budget.`);
  return entry.budgetMs;
}

const Reply = z.object({ result: z.object({ content: z.array(z.object({ type: z.literal("text"), text: z.string() })) }) });
const Sse = z.string().transform((body) => body.split("\n").find((l) => l.startsWith("data: "))?.slice(6) ?? body);

describe("MCP get_trip", () => {
  it("answers through the in-memory client inside its budget", async () => {
    const { ctx } = await testContext();
    const { token } = await createAssistantToken(ctx, USERS.jacob.id, { label: "Perf" });
    const who = await resolveAssistantToken(ctx, token);
    if (!who) throw new Error("token rejected");
    const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
    await createMcpServer(ctx, who).connect(serverSide);
    const client = new Client({ name: "perf", version: "1.0.0" });
    await client.connect(clientSide);
    const call = () => client.callTool({ name: "get_trip", arguments: { trip_id: TRIP_ID } });
    const ms = await measureAsync(call, { samples: SAMPLES, warmup: WARMUP });
    check("mcp", "get_trip/in-memory", ms, budgetFor("get_trip/in-memory"), SAMPLES);
  });

  it("answers over HTTP from the built app inside its budget", async () => {
    const url = `${inject("perfBaseUrl")}/api/mcp`;
    const call = async () => {
      const res = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json", accept: "application/json, text/event-stream", authorization: `Bearer ${inject("perfToken")}` },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "get_trip", arguments: { trip_id: TRIP_ID } } }),
      });
      expect(res.status).toBe(200);
      const reply = Reply.parse(JSON.parse(Sse.parse(await res.text())));
      expect(reply.result.content[0]?.text).toContain("NH159");
    };
    const ms = await measureAsync(call, { samples: SAMPLES, warmup: WARMUP });
    check("mcp", "get_trip/http", ms, budgetFor("get_trip/http"), SAMPLES);
  });
});
