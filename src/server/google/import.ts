import type { Requester } from "@/domain/types";
import { assertCanEditTrip } from "@/domain/visibility/project";
import type { CalendarEvent } from "@/domain/import/calendar-event";
import { InputProblem } from "@/domain/import/problem";
import type { GoogleCalendarReader } from "./calendar-api";
import type { ServiceContext } from "../services/context";
import { importCalendarEvents } from "../services/inbox-service";
import { requireAggregate } from "../services/trip-service";

export interface GoogleImportInput {
  calendarIds: string[];
  from: string;
  to: string;
  calendarTravelers?: Record<string, string[]>;
}

export interface GoogleImportResult {
  calendars: string[];
  events: number;
}

const MAX_RANGE_DAYS = 400;
const MAX_CALENDARS = 10;
const DAY = 86_400_000;

function range(from: string, to: string): { timeMin: string; timeMax: string } {
  const start = /^\d{4}-\d{2}-\d{2}$/.test(from) ? Date.parse(`${from}T00:00:00Z`) : Number.NaN;
  const end = /^\d{4}-\d{2}-\d{2}$/.test(to) ? Date.parse(`${to}T00:00:00Z`) + DAY : Number.NaN;
  if (!Number.isFinite(start) || !Number.isFinite(end)) throw new InputProblem("Choose a start and an end date.");
  if (end <= start) throw new InputProblem("The end date must come after the start date.");
  if (end - start > MAX_RANGE_DAYS * DAY) throw new InputProblem(`Choose a range of at most ${MAX_RANGE_DAYS} days.`);
  return { timeMin: new Date(start - DAY).toISOString(), timeMax: new Date(end + DAY).toISOString() };
}

export async function importFromGoogle(ctx: ServiceContext, reader: GoogleCalendarReader, tripId: string, requester: Requester, input: GoogleImportInput): Promise<GoogleImportResult> {
  assertCanEditTrip(await requireAggregate(ctx.db, tripId), requester);
  const window = range(input.from, input.to);
  const ids = [...new Set(input.calendarIds)];
  if (ids.length === 0) throw new InputProblem("Choose at least one calendar.");
  if (ids.length > MAX_CALENDARS) throw new InputProblem(`Choose at most ${MAX_CALENDARS} calendars.`);
  const offered = new Map((await reader.listCalendars()).map((c) => [c.id, c.summary]));
  const chosen = ids.map((id) => ({ id, summary: offered.get(id) }));
  const unknown = chosen.filter((c) => c.summary === undefined);
  if (unknown.length > 0) throw new InputProblem("One of those calendars is not in your Google account.");
  const events: CalendarEvent[] = [];
  const names: string[] = [];
  for (const calendar of chosen) {
    if (calendar.summary === undefined) continue;
    names.push(calendar.summary);
    for (const event of await reader.listEvents(calendar.id, window)) events.push({ ...event, calendar: calendar.summary });
  }
  if (events.length > 0) await importCalendarEvents(ctx, tripId, requester, events, { source: "google_calendar", label: `Google Calendar, ${names.length === 1 ? "1 calendar" : `${names.length} calendars`}`, calendarTravelers: input.calendarTravelers });
  return { calendars: names, events: events.length };
}
