import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import type { ServiceContext } from "../services/context";
import type { AssistantIdentity } from "../services/assistant-service";
import { getTripView, listTrips, requireAggregate } from "../services/trip-service";
import { disagreementFindings, importCalendarEvents, importProposals, listInbox } from "../services/inbox-service";
import { describeInbox, describeTrip } from "./describe";
import { ItemInput, inputToProposal, InputProblem } from "@/domain/import/quick-add";
import { buildDeadlineLines } from "@/domain/deadlines/deadlines";
import { runChecks } from "@/domain/checks/checks";
import { AccessDenied } from "@/domain/visibility/project";
import type { ProposedItem } from "@/domain/import/proposal";
import type { Requester } from "@/domain/types";

const SERVER_INSTRUCTIONS = [
  "Trip planner holds the shared itinerary for a trip: flights, stays, plans and transfers.",
  "Use get_trip before adding anything, so you do not propose items that already exist.",
  "add_items and import_calendar_events never change the trip directly. They send items to the trip's review inbox, where a person approves, merges or discards them.",
  "Give times as local wall clock times at the place (departure airport for departures, arrival airport for arrivals). Never convert to UTC or another zone.",
  "Use IATA airport codes for flights. Only send facts you read from a source such as a confirmation email; leave a field out rather than guess it.",
].join(" ");

const CalendarEventTime = z.object({ dateTime: z.string().optional(), date: z.string().optional(), timeZone: z.string().optional() });
const CalendarEventInput = z.object({
  summary: z.string(),
  description: z.string().optional(),
  location: z.string().optional(),
  calendar: z.string().optional(),
  start: CalendarEventTime,
  end: CalendarEventTime,
});

const text = (t: string, structured?: Record<string, unknown>): CallToolResult => ({
  content: [{ type: "text", text: t }],
  ...(structured ? { structuredContent: structured } : {}),
});
const failure = (t: string): CallToolResult => ({ content: [{ type: "text", text: t }], isError: true });

export function createMcpServer(ctx: ServiceContext, who: AssistantIdentity): McpServer {
  const requester: Requester = { kind: "member", userId: who.userId, homeZone: who.homeZone };
  const via = `assistant:${who.label}`;
  const server = new McpServer({ name: "trip-planner", version: "0.1.0" }, { instructions: SERVER_INSTRUCTIONS });

  function allowedTrip(tripId: string) {
    if (who.tripId && who.tripId !== tripId) throw new AccessDenied("This assistant connection is limited to a different trip.");
  }

  async function guarded(run: () => Promise<CallToolResult>): Promise<CallToolResult> {
    try {
      return await run();
    } catch (e) {
      if (e instanceof AccessDenied || e instanceof InputProblem) return failure(e.message);
      if (e instanceof z.ZodError) return failure(e.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("\n"));
      throw e;
    }
  }

  server.registerTool(
    "list_trips",
    { title: "List trips", description: "Trips you can see, with your role on each.", annotations: { readOnlyHint: true } },
    () =>
      guarded(async () => {
        const trips = (await listTrips(ctx, who.userId)).filter((t) => !who.tripId || t.id === who.tripId);
        return text(trips.map((t) => `${t.name} (id ${t.id}, you are ${t.role})`).join("\n") || "You are not on any trips.", { trips });
      }),
  );

  server.registerTool(
    "get_trip",
    {
      title: "Get trip",
      description: "The whole itinerary day by day in local times, with deadlines and problems found. Read this before proposing items.",
      inputSchema: { trip_id: z.string() },
      annotations: { readOnlyHint: true },
    },
    ({ trip_id }) =>
      guarded(async () => {
        allowedTrip(trip_id);
        const view = await getTripView(ctx, trip_id, requester);
        const extra = await disagreementFindings(ctx, trip_id, requester);
        const findings = runChecks(view, { extra });
        const deadlines = buildDeadlineLines(view, ctx.now().getTime());
        return text(describeTrip(view, deadlines, findings));
      }),
  );

  server.registerTool(
    "add_items",
    {
      title: "Propose trip items",
      description:
        "Send flights, stays, plans or transfers to the trip's review inbox. A person approves them before they appear on the trip. Times are local at the place; zones are worked out from airports and cities.",
      inputSchema: { trip_id: z.string(), items: z.array(ItemInput).min(1).max(50) },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
    },
    ({ trip_id, items }) =>
      guarded(async () => {
        if (who.scope !== "propose") return failure("This assistant connection is read only.");
        allowedTrip(trip_id);
        const agg = await requireAggregate(ctx.db, trip_id);
        const proposals: ProposedItem[] = [];
        const problems: string[] = [];
        items.forEach((input, i) => {
          try {
            proposals.push(inputToProposal(input, agg.travelers));
          } catch (e) {
            if (!(e instanceof InputProblem)) throw e;
            problems.push(`Item ${i + 1}: ${e.message}`);
          }
        });
        const batch = proposals.length ? await importProposals(ctx, trip_id, requester, proposals, { source: "assistant", label: who.label, via }) : { count: 0 };
        const summary = [`Sent ${batch.count} item${batch.count === 1 ? "" : "s"} to the review inbox.`, ...problems].join("\n");
        return text(summary, { sent: batch.count, problems });
      }),
  );

  server.registerTool(
    "import_calendar_events",
    {
      title: "Propose calendar events",
      description:
        "Send calendar style events (as Google Calendar returns them: summary, description, location, start and end with dateTime or date) to the review inbox. Use this when you have events or reservation emails but not structured fields.",
      inputSchema: {
        trip_id: z.string(),
        events: z.array(CalendarEventInput).min(1).max(100),
        traveler_names: z.array(z.string()).optional().describe("Who these events are for. Defaults to you."),
      },
      annotations: { readOnlyHint: false, destructiveHint: false },
    },
    ({ trip_id, events, traveler_names }) =>
      guarded(async () => {
        if (who.scope !== "propose") return failure("This assistant connection is read only.");
        allowedTrip(trip_id);
        const agg = await requireAggregate(ctx.db, trip_id);
        const travelerIds = traveler_names?.map((n) => {
          const t = agg.travelers.find((x) => x.name.toLowerCase() === n.toLowerCase() || x.name.toLowerCase().split(" ")[0] === n.toLowerCase());
          if (!t) throw new InputProblem(`There is no traveler called "${n}" on this trip.`);
          return t.id;
        });
        const batch = await importCalendarEvents(ctx, trip_id, requester, events, { source: "assistant", label: who.label, via, travelerIds });
        return text(`Sent ${batch.count} item${batch.count === 1 ? "" : "s"} to the review inbox.`, { sent: batch.count });
      }),
  );

  server.registerTool(
    "list_review_inbox",
    {
      title: "List review inbox",
      description: "Imported items waiting for a person to approve, with matches and disagreements.",
      inputSchema: { trip_id: z.string() },
      annotations: { readOnlyHint: true },
    },
    ({ trip_id }) =>
      guarded(async () => {
        allowedTrip(trip_id);
        return text(describeInbox(await listInbox(ctx, trip_id, requester)));
      }),
  );

  return server;
}
