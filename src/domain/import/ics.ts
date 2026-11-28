import ICAL from "ical.js";
import { DateTime } from "../time/luxon";
import { isValidZone } from "../time/format";
import type { CalendarEvent, CalendarEventTime } from "./calendar-event";
import { InputProblem } from "./problem";

export const MAX_ICS_CHARS = 2 * 1024 * 1024;
export const MAX_ICS_EVENTS = 2000;
const MAX_FIELD_CHARS = 20_000;

export type SkipReason = "cancelled" | "override" | "no_start" | "unreadable_time" | "unknown_zone" | "over_limit";

export interface IcsResult {
  events: CalendarEvent[];
  skipped: Record<SkipReason, number>;
  repeating: number;
}

const NOT_A_CALENDAR = "We could not read that file as a calendar.";

class Skip extends Error {
  constructor(readonly reason: SkipReason) {
    super(reason);
    this.name = "Skip";
  }
}

function pad(n: number, width = 2): string {
  return String(n).padStart(width, "0");
}

function textOf(component: ICAL.Component, name: string): string | undefined {
  const value = component.getFirstPropertyValue(name);
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed === "" ? undefined : trimmed.slice(0, MAX_FIELD_CHARS);
}

function timeOf(component: ICAL.Component, name: string): { time: ICAL.Time; tzid: string | undefined } | null {
  const prop = component.getFirstProperty(name);
  if (!prop) return null;
  const value = prop.getFirstValue();
  if (!(value instanceof ICAL.Time)) return null;
  const param = prop.getParameter("tzid");
  return { time: value, tzid: typeof param === "string" ? param : undefined };
}

function localText(time: ICAL.Time): string {
  return `${pad(time.year, 4)}-${pad(time.month)}-${pad(time.day)}T${pad(time.hour)}:${pad(time.minute)}:${pad(time.second)}`;
}

function toEventTime(read: { time: ICAL.Time; tzid: string | undefined }): CalendarEventTime {
  const { time, tzid } = read;
  if (time.isDate) return { date: `${pad(time.year, 4)}-${pad(time.month)}-${pad(time.day)}` };
  const local = localText(time);
  if (time.zone.tzid === "UTC") return { dateTime: `${local}Z` };
  if (tzid === undefined) return { dateTime: local };
  if (!isValidZone(tzid)) throw new Skip("unknown_zone");
  const zoned = DateTime.fromISO(local, { zone: tzid });
  return { dateTime: zoned.toISO({ suppressMilliseconds: true }), timeZone: tzid };
}

function endOf(component: ICAL.Component, start: { time: ICAL.Time; tzid: string | undefined }, startTime: CalendarEventTime): CalendarEventTime {
  const end = timeOf(component, "dtend");
  if (end) return toEventTime(end);
  const duration = component.getFirstPropertyValue("duration");
  if (duration instanceof ICAL.Duration && startTime.dateTime !== undefined) {
    const shifted = DateTime.fromISO(startTime.dateTime, startTime.timeZone ? { zone: startTime.timeZone, setZone: true } : { setZone: true }).plus({ seconds: duration.toSeconds() });
    return { dateTime: shifted.toISO({ suppressMilliseconds: true }), ...(startTime.timeZone ? { timeZone: startTime.timeZone } : {}) };
  }
  if (start.time.isDate) {
    const next = DateTime.fromISO(startTime.date ?? "", { zone: "utc" }).plus({ days: 1 });
    return { date: next.toISODate() };
  }
  return startTime;
}

function readEvent(component: ICAL.Component, calendar: string | undefined): CalendarEvent {
  if (textOf(component, "status")?.toUpperCase() === "CANCELLED") throw new Skip("cancelled");
  if (component.hasProperty("recurrence-id")) throw new Skip("override");
  const start = timeOf(component, "dtstart");
  if (!start) throw new Skip("no_start");
  const startTime = toEventTime(start);
  const endTime = endOf(component, start, startTime);
  const uid = textOf(component, "uid");
  const description = textOf(component, "description");
  const location = textOf(component, "location");
  return {
    ...(uid ? { id: uid } : {}),
    ...(calendar ? { calendar } : {}),
    summary: textOf(component, "summary") ?? "",
    ...(description ? { description } : {}),
    ...(location ? { location } : {}),
    start: startTime,
    end: endTime,
  };
}

function toEvent(component: ICAL.Component, calendar: string | undefined): CalendarEvent {
  try {
    return readEvent(component, calendar);
  } catch (e) {
    if (e instanceof Skip) throw e;
    if (e instanceof Error) throw new Skip("unreadable_time");
    throw e;
  }
}

export function parseIcs(text: string, opts: { calendar?: string } = {}): IcsResult {
  if (text.length > MAX_ICS_CHARS) throw new InputProblem("That calendar is bigger than 2 MB.");
  let root: ICAL.Component;
  try {
    root = new ICAL.Component(ICAL.parse(text));
  } catch (e) {
    if (e instanceof Error) throw new InputProblem(NOT_A_CALENDAR);
    throw e;
  }
  if (root.name !== "vcalendar") throw new InputProblem(NOT_A_CALENDAR);
  const result: IcsResult = {
    events: [],
    skipped: { cancelled: 0, override: 0, no_start: 0, unreadable_time: 0, unknown_zone: 0, over_limit: 0 },
    repeating: 0,
  };
  for (const component of root.getAllSubcomponents("vevent")) {
    if (result.events.length >= MAX_ICS_EVENTS) {
      result.skipped.over_limit += 1;
      continue;
    }
    try {
      result.events.push(toEvent(component, opts.calendar));
      if (component.hasProperty("rrule")) result.repeating += 1;
    } catch (e) {
      if (e instanceof Skip) result.skipped[e.reason] += 1;
      else throw e;
    }
  }
  if (result.events.length === 0 && Object.values(result.skipped).every((n) => n === 0)) throw new InputProblem("We found no events in that calendar.");
  return result;
}
