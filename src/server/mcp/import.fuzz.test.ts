import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { TRIP_ID, USERS } from "@/fixtures/december-trip";
import { FUZZ_SEED, fuzzParams, garbageDate, garbageInstant, garbageText, garbageZone, hugeText } from "@/domain/import/fuzz-config";
import { isValidZone } from "@/domain/time/format";
import { testContext } from "../testing";
import { createAssistantToken, resolveAssistantToken } from "../services/assistant-service";
import { listInbox } from "../services/inbox-service";
import { createMcpServer } from "./server";
import type { ServiceContext } from "../services/context";

async function connect(ctx: ServiceContext, token: string) {
  const who = await resolveAssistantToken(ctx, token);
  if (!who) throw new Error("token rejected");
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  await createMcpServer(ctx, who).connect(serverSide);
  const client = new Client({ name: "fuzz-assistant", version: "1.0.0" });
  await client.connect(clientSide);
  return client;
}

const text = fc.option(fc.oneof(garbageText, hugeText), { nil: undefined });
const place = fc.option(fc.oneof(garbageText, fc.constantFrom("Haneda Airport", "Tokyo", "1-2-3 Ueno, Tokyo, Japan", "Springfield", "Cairo", "Hong Kong")), { nil: undefined });
const timedPart = fc.record({ dateTime: fc.option(garbageInstant, { nil: undefined }), date: fc.option(garbageDate, { nil: undefined }), timeZone: fc.option(garbageZone, { nil: undefined }) }, { requiredKeys: [] });
const eventBody = { summary: fc.oneof(garbageText, fc.constantFrom("NH159 JFK → HND", "CX 509 to HKG", "Hotel Resol Ueno (Tokyo)")), description: text, location: place, calendar: text };
const calendarEvent = fc.oneof(
  fc.record({ ...eventBody, start: timedPart, end: timedPart }),
  fc.record({ ...eventBody, start: fc.record({ dateTime: garbageInstant, timeZone: fc.option(garbageZone, { nil: undefined }) }, { requiredKeys: ["dateTime"] }), end: fc.record({ dateTime: garbageInstant }) }),
  fc.record({ ...eventBody, start: fc.record({ date: garbageDate }), end: fc.record({ date: garbageDate }) }),
);

const localDateTime = fc.oneof(
  fc.date({ min: new Date("2026-01-01T00:00:00Z"), max: new Date("2027-12-31T00:00:00Z"), noInvalidDate: true }).map((d) => d.toISOString().slice(0, 16)),
  fc.constantFrom("2026-03-08T02:30", "2026-11-01T01:30", "2026-02-30T10:00", "2026-12-05T25:99", "9999-12-31T23:59"),
  garbageText,
);
const localDate = fc.oneof(fc.constantFrom("2026-12-05", "2026-12-06", "2026-02-30", "0000-00-00"), garbageText);
const airport = fc.oneof(fc.constantFrom("NRT", "HND", "JFK", "HKG", "QQQ", "ZZZ"), garbageText);
const item = fc.oneof(
  fc.record({ type: fc.constant("flight"), flightNumber: fc.constantFrom("NH159", "CX 509", "XX1"), fromAirport: airport, toAirport: airport, departLocal: localDateTime, arriveLocal: localDateTime }),
  fc.record({ type: fc.constant("stay"), name: garbageText, city: place, address: place, checkInDate: localDate, checkOutDate: localDate }, { requiredKeys: ["type", "name", "checkInDate", "checkOutDate"] }),
  fc.record({ type: fc.constant("plan"), title: garbageText, city: place, startLocal: localDateTime, endLocal: fc.option(localDateTime, { nil: undefined }) }, { requiredKeys: ["type", "title", "startLocal"] }),
  fc.record({ type: fc.constant("transfer"), fromCity: garbageText, toCity: garbageText, startLocal: localDateTime, endLocal: localDateTime }),
  fc.jsonValue(),
);

async function setup() {
  const { ctx } = await testContext({ withItems: false });
  const { token } = await createAssistantToken(ctx, USERS.jacob.id, { label: "Fuzz assistant" });
  return { ctx, client: await connect(ctx, token) };
}

const jacob = { kind: "member" as const, userId: USERS.jacob.id, homeZone: USERS.jacob.homeZone };

async function expectInboxSound(ctx: ServiceContext) {
  for (const entry of await listInbox(ctx, TRIP_ID, jacob)) {
    const p = entry.proposed;
    expect(isValidZone(p.start.zone)).toBe(true);
    expect(isValidZone(p.end.zone)).toBe(true);
    expect(Number.isFinite(Date.parse(p.start.at))).toBe(true);
    expect(Number.isFinite(Date.parse(p.end.at))).toBe(true);
    if (p.problems.length) expect(p.status).toBe("needs_review");
  }
}

describe(`MCP import tools fuzz (seed ${FUZZ_SEED})`, () => {
  it("add_items answers every input with a result and only ever queues sound proposals", async () => {
    const { ctx, client } = await setup();
    await fc.assert(
      fc.asyncProperty(fc.array(item, { minLength: 1, maxLength: 5 }), async (items) => {
        const result = await client.callTool({ name: "add_items", arguments: { trip_id: TRIP_ID, items } });
        expect(Array.isArray(result.content)).toBe(true);
      }),
      fuzzParams(80),
    );
    await expectInboxSound(ctx);
  });

  it("import_calendar_events answers every input with a result and only ever queues sound proposals", async () => {
    const { ctx, client } = await setup();
    await fc.assert(
      fc.asyncProperty(fc.array(calendarEvent, { minLength: 1, maxLength: 5 }), async (events) => {
        const result = await client.callTool({ name: "import_calendar_events", arguments: { trip_id: TRIP_ID, events } });
        expect(Array.isArray(result.content)).toBe(true);
      }),
      fuzzParams(80),
    );
    await expectInboxSound(ctx);
  });

  it("an event with no readable time is refused with a message, not queued", async () => {
    const { ctx, client } = await setup();
    const result = await client.callTool({ name: "import_calendar_events", arguments: { trip_id: TRIP_ID, events: [{ summary: "Dinner", start: { dateTime: "" }, end: { dateTime: "x" } }] } });
    expect(result.isError).toBe(true);
    expect(await listInbox(ctx, TRIP_ID, jacob)).toEqual([]);
  });

  it("an event with no place and no zone is queued with a problem and needs review", async () => {
    const { ctx, client } = await setup();
    const result = await client.callTool({
      name: "import_calendar_events",
      arguments: { trip_id: TRIP_ID, events: [{ summary: "Dinner", start: { dateTime: "2026-12-05T19:00:00" }, end: { dateTime: "2026-12-05T21:00:00" } }] },
    });
    expect(result.isError).toBeFalsy();
    const [entry] = await listInbox(ctx, TRIP_ID, jacob);
    expect(entry.proposed.problems.length).toBeGreaterThan(0);
    expect(entry.proposed.status).toBe("needs_review");
  });
});
