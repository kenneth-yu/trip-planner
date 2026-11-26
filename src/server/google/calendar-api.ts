import { z } from "zod";
import type { MirrorEvent } from "@/domain/mirror/calendar-mirror";

const Created = z.object({ id: z.string() });

export const MIRROR_SCOPE = "https://www.googleapis.com/auth/calendar.app.created";
export const IMPORT_SCOPE = "https://www.googleapis.com/auth/calendar.readonly";

export interface GoogleCalendarApi {
  createCalendar(summary: string, timeZone: string): Promise<{ id: string }>;
  insertEvent(calendarId: string, event: MirrorEvent): Promise<{ id: string }>;
  updateEvent(calendarId: string, eventId: string, event: MirrorEvent): Promise<void>;
  deleteEvent(calendarId: string, eventId: string): Promise<void>;
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

const BASE = "https://www.googleapis.com/calendar/v3";

export function googleCalendarRest(getAccessToken: () => Promise<string>, fetchImpl: typeof fetch = fetch): GoogleCalendarApi {
  async function call(method: string, path: string, body?: unknown): Promise<unknown> {
    const res = await fetchImpl(`${BASE}${path}`, {
      method,
      headers: { authorization: `Bearer ${await getAccessToken()}`, "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    if (!res.ok) throw new GoogleApiError(res.status, `Google Calendar ${method} ${path} failed: ${res.status} ${await res.text()}`);
    return res.status === 204 ? undefined : res.json();
  }
  const cal = (id: string) => encodeURIComponent(id);
  return {
    createCalendar: async (summary, timeZone) =>
      Created.parse(await call("POST", "/calendars", { summary, timeZone, description: "Kept in sync by Trip planner. Edit the trip in the app." })),
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

export class FakeGoogleCalendar implements GoogleCalendarApi {
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
