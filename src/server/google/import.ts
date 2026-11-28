import type { Requester } from "@/domain/types";
import { assertCanEditTrip } from "@/domain/visibility/project";
import type { CalendarEvent } from "@/domain/import/calendar-event";
import { InputProblem } from "@/domain/import/problem";
import { EventLimitExceeded, type GoogleCalendarReader } from "./calendar-api";
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

export const MAX_RANGE_DAYS = 364;
export const MAX_CALENDARS = 10;
export const MAX_EVENTS = 500;
export const DEFAULT_WINDOW_DAYS = 60;
const DAY = 86_400_000;

const isoDay = (ms: number) => new Date(ms).toISOString().slice(0, 10);

export function defaultImportRange(starts: string[], ends: string[], today: Date): { from: string; to: string } {
  const first = starts.map((at) => Date.parse(at)).filter(Number.isFinite).sort((a, b) => a - b)[0];
  const last = ends.map((at) => Date.parse(at)).filter(Number.isFinite).sort((a, b) => b - a)[0];
  if (first === undefined || last === undefined) return { from: isoDay(today.getTime()), to: isoDay(today.getTime() + DEFAULT_WINDOW_DAYS * DAY) };
  const from = first - DAY;
  const to = Math.min(last + DAY, from + (MAX_RANGE_DAYS - 1) * DAY);
  return { from: isoDay(from), to: isoDay(to) };
}

function range(from: string, to: string): { timeMin: string; timeMax: string } {
  const start = /^\d{4}-\d{2}-\d{2}$/.test(from) ? Date.parse(`${from}T00:00:00Z`) : Number.NaN;
  const end = /^\d{4}-\d{2}-\d{2}$/.test(to) ? Date.parse(`${to}T00:00:00Z`) + DAY : Number.NaN;
  if (!Number.isFinite(start) || !Number.isFinite(end)) throw new InputProblem("Choose a start and an end date.");
  if (end <= start) throw new InputProblem("The end date must come after the start date.");
  if (end - start > MAX_RANGE_DAYS * DAY) throw new InputProblem("Choose a range shorter than a year.");
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
    try {
      for (const event of await reader.listEvents(calendar.id, window, MAX_EVENTS - events.length)) events.push({ ...event, calendar: calendar.summary });
    } catch (e) {
      if (e instanceof EventLimitExceeded) throw new InputProblem(`That range has more than ${MAX_EVENTS} events. Choose fewer calendars or a shorter range.`);
      throw e;
    }
  }
  if (events.length > 0) await importCalendarEvents({ ...ctx, geocoder: undefined }, tripId, requester, events, { source: "google_calendar", label: `Google Calendar, ${names.length === 1 ? "1 calendar" : `${names.length} calendars`}`, calendarTravelers: input.calendarTravelers });
  return { calendars: names, events: events.length };
}
