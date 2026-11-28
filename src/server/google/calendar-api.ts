import { z } from "zod";
import type { CalendarEvent } from "@/domain/import/calendar-event";
import type { MirrorEvent } from "@/domain/mirror/calendar-mirror";

const Created = z.object({ id: z.string() });

export const MIRROR_SCOPE = "https://www.googleapis.com/auth/calendar.app.created";
export const IMPORT_SCOPE = "https://www.googleapis.com/auth/calendar.readonly";

export interface GoogleCalendarApi {
  createCalendar(summary: string, timeZone: string): Promise<{ id: string }>;
  deleteCalendar(calendarId: string): Promise<void>;
  insertEvent(calendarId: string, event: MirrorEvent): Promise<{ id: string }>;
  updateEvent(calendarId: string, eventId: string, event: MirrorEvent): Promise<void>;
  deleteEvent(calendarId: string, eventId: string): Promise<void>;
}

export interface ListedCalendar {
  id: string;
  summary: string;
}

export interface EventRange {
  timeMin: string;
  timeMax: string;
}

export interface GoogleCalendarReader {
  listCalendars(): Promise<ListedCalendar[]>;
  listEvents(calendarId: string, range: EventRange): Promise<CalendarEvent[]>;
}

export class GoogleApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "GoogleApiError";
  }
}

export class GoogleAuthorizationError extends GoogleApiError {
  constructor(status: number, message: string) {
    super(status, message);
    this.name = "GoogleAuthorizationError";
  }
}

const BASE = "https://www.googleapis.com/calendar/v3";

const TRANSIENT_FORBIDDEN_REASONS = ["rateLimitExceeded", "userRateLimitExceeded", "quotaExceeded", "dailyLimitExceeded", "backendError"] as const;
const AUTHORIZATION_FORBIDDEN_REASONS = ["forbidden", "insufficientPermissions", "insufficientFilePermissions", "domainPolicy", "accessNotConfigured", "authError"] as const;

const ErrorBody = z.object({ error: z.object({ errors: z.array(z.object({ reason: z.string() })).optional() }) });

async function forbiddenReason(res: Response): Promise<string | null> {
  let body: unknown = null;
  try {
    body = await res.json();
  } catch (e) {
    if (!(e instanceof SyntaxError)) throw e;
  }
  const parsed = ErrorBody.safeParse(body);
  return parsed.success ? (parsed.data.error.errors?.[0]?.reason ?? null) : null;
}

async function failureFor(method: string, res: Response): Promise<GoogleApiError> {
  if (res.status === 401) return new GoogleAuthorizationError(401, `Google Calendar ${method} failed: 401`);
  if (res.status !== 403) return new GoogleApiError(res.status, `Google Calendar ${method} failed: ${res.status}`);
  const reason = await forbiddenReason(res);
  const known = [...TRANSIENT_FORBIDDEN_REASONS, ...AUTHORIZATION_FORBIDDEN_REASONS].find((r) => r === reason);
  const message = `Google Calendar ${method} failed: 403 ${known ?? "unclassified"}`;
  return AUTHORIZATION_FORBIDDEN_REASONS.some((r) => r === known) ? new GoogleAuthorizationError(403, message) : new GoogleApiError(403, message);
}

export function googleCalendarRest(getAccessToken: () => Promise<string>, fetchImpl: typeof fetch = fetch): GoogleCalendarApi {
  async function call(method: string, path: string, body?: unknown): Promise<unknown> {
    const res = await fetchImpl(`${BASE}${path}`, {
      method,
      headers: { authorization: `Bearer ${await getAccessToken()}`, "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    if (!res.ok) throw await failureFor(method, res);
    return res.status === 204 ? undefined : res.json();
  }
  const cal = (id: string) => encodeURIComponent(id);
  return {
    createCalendar: async (summary, timeZone) =>
      Created.parse(await call("POST", "/calendars", { summary, timeZone, description: "Kept in sync by Trip planner. Edit the trip in the app." })),
    deleteCalendar: async (calendarId) => {
      try {
        await call("DELETE", `/calendars/${cal(calendarId)}`);
      } catch (e) {
        if (e instanceof GoogleApiError && (e.status === 404 || e.status === 410)) return;
        throw e;
      }
    },
    insertEvent: async (calendarId, event) => Created.parse(await call("POST", `/calendars/${cal(calendarId)}/events`, event)),
    updateEvent: async (calendarId, eventId, event) => {
      await call("PUT", `/calendars/${cal(calendarId)}/events/${encodeURIComponent(eventId)}`, event);
    },
    deleteEvent: async (calendarId, eventId) => {
      try {
        await call("DELETE", `/calendars/${cal(calendarId)}/events/${encodeURIComponent(eventId)}`);
      } catch (e) {
        if (e instanceof GoogleApiError && (e.status === 404 || e.status === 410)) return;
        throw e;
      }
    },
  };
}

const EventTime = z.object({ dateTime: z.string().optional(), date: z.string().optional(), timeZone: z.string().optional() });
const EventResource = z.object({
  id: z.string().optional(),
  status: z.string().optional(),
  summary: z.string().optional(),
  description: z.string().optional(),
  location: z.string().optional(),
  htmlLink: z.string().optional(),
  start: EventTime,
  end: EventTime,
});
const CalendarListPage = z.object({
  nextPageToken: z.string().optional(),
  items: z.array(z.object({ id: z.string(), summary: z.string().optional(), summaryOverride: z.string().optional() })).default([]),
});
const EventsPage = z.object({ nextPageToken: z.string().optional(), items: z.array(z.unknown()).default([]) });
const MAX_PAGES = 20;

export function googleCalendarReader(getAccessToken: () => Promise<string>, fetchImpl: typeof fetch = fetch): GoogleCalendarReader {
  async function get(path: string, params: URLSearchParams): Promise<unknown> {
    const res = await fetchImpl(`${BASE}${path}?${params}`, { method: "GET", headers: { authorization: `Bearer ${await getAccessToken()}` } });
    if (!res.ok) throw await failureFor("GET", res);
    return res.json();
  }
  return {
    listCalendars: async () => {
      const found: ListedCalendar[] = [];
      let pageToken: string | undefined;
      for (let page = 0; page < MAX_PAGES; page++) {
        const params = new URLSearchParams({ maxResults: "250", minAccessRole: "reader" });
        if (pageToken) params.set("pageToken", pageToken);
        const parsed = CalendarListPage.parse(await get("/users/me/calendarList", params));
        for (const item of parsed.items) found.push({ id: item.id, summary: item.summaryOverride ?? item.summary ?? item.id });
        pageToken = parsed.nextPageToken;
        if (!pageToken) return found;
      }
      throw new GoogleApiError(502, "Google Calendar listing did not end");
    },
    listEvents: async (calendarId, range) => {
      const events: CalendarEvent[] = [];
      let pageToken: string | undefined;
      for (let page = 0; page < MAX_PAGES; page++) {
        const params = new URLSearchParams({ singleEvents: "true", orderBy: "startTime", maxResults: "250", timeMin: range.timeMin, timeMax: range.timeMax });
        if (pageToken) params.set("pageToken", pageToken);
        const parsed = EventsPage.parse(await get(`/calendars/${encodeURIComponent(calendarId)}/events`, params));
        for (const raw of parsed.items) {
          const event = EventResource.parse(raw);
          if (event.status === "cancelled") continue;
          events.push({ id: event.id, summary: event.summary, description: event.description, location: event.location, htmlLink: event.htmlLink, start: event.start, end: event.end });
        }
        pageToken = parsed.nextPageToken;
        if (!pageToken) return events;
      }
      throw new GoogleApiError(502, "Google Calendar events did not end");
    },
  };
}

export class FakeGoogleCalendar implements GoogleCalendarApi, GoogleCalendarReader {
  readable = new Map<string, { summary: string; events: CalendarEvent[] }>();
  reads: string[] = [];

  seedCalendar(summary: string, events: CalendarEvent[]): string {
    const id = `read-${this.readable.size + 1}@group.calendar.google.com`;
    this.readable.set(id, { summary, events: structuredClone(events) });
    return id;
  }
  async listCalendars(): Promise<ListedCalendar[]> {
    this.maybeFail();
    this.reads.push("listCalendars");
    return [...this.readable.entries()].map(([id, c]) => ({ id, summary: c.summary }));
  }
  async listEvents(calendarId: string, range: EventRange): Promise<CalendarEvent[]> {
    this.maybeFail();
    this.reads.push(`listEvents ${calendarId}`);
    const calendar = this.readable.get(calendarId);
    if (!calendar) throw new GoogleApiError(404, "Calendar not found");
    const from = Date.parse(range.timeMin);
    const to = Date.parse(range.timeMax);
    const edge = (time: { dateTime?: string; date?: string }) => Date.parse(time.dateTime ?? `${time.date}T00:00:00Z`);
    return structuredClone(calendar.events.filter((e) => edge(e.end) > from && edge(e.start) < to));
  }

  calendars = new Map<string, { summary: string; timeZone: string; events: Map<string, MirrorEvent> }>();
  calls: string[] = [];
  private n = 0;
  failNext: Error | null = null;

  private maybeFail() {
    if (this.failNext) {
      const e = this.failNext;
      this.failNext = null;
      throw e;
    }
  }

  async createCalendar(summary: string, timeZone: string) {
    this.maybeFail();
    const id = `cal-${++this.n}@group.calendar.google.com`;
    this.calendars.set(id, { summary, timeZone, events: new Map() });
    this.calls.push(`createCalendar ${summary}`);
    return { id };
  }
  async deleteCalendar(calendarId: string) {
    this.maybeFail();
    this.calendars.delete(calendarId);
    this.calls.push(`deleteCalendar ${calendarId}`);
  }
  async insertEvent(calendarId: string, event: MirrorEvent) {
    this.maybeFail();
    const id = `evt${++this.n}`;
    this.cal(calendarId).events.set(id, structuredClone(event));
    this.calls.push(`insert ${event.summary}`);
    return { id };
  }
  async updateEvent(calendarId: string, eventId: string, event: MirrorEvent) {
    this.maybeFail();
    const c = this.cal(calendarId);
    if (!c.events.has(eventId)) throw new GoogleApiError(404, "Not found");
    c.events.set(eventId, structuredClone(event));
    this.calls.push(`update ${event.summary}`);
  }
  async deleteEvent(calendarId: string, eventId: string) {
    this.maybeFail();
    this.cal(calendarId).events.delete(eventId);
    this.calls.push(`delete ${eventId}`);
  }
  private cal(id: string) {
    const c = this.calendars.get(id);
    if (!c) throw new GoogleApiError(404, "Calendar not found");
    return c;
  }
  allEvents(): MirrorEvent[] {
    return [...this.calendars.values()].flatMap((c) => [...c.events.values()]);
  }
}
