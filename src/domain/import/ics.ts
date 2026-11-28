import ICAL from "ical.js";
import { DateTime } from "../time/luxon";
import { isValidZone } from "../time/format";
import type { CalendarEvent, CalendarEventTime } from "./calendar-event";
import { InputProblem } from "./problem";

export const MAX_ICS_BYTES = 2 * 1024 * 1024;
export const MAX_ICS_EVENTS = 2000;
const MAX_FIELD_CHARS = 20_000;
const EARLIEST_YEAR = 1970;
const LATEST_YEAR = 2100;

export type SkipReason = "cancelled" | "override" | "no_start" | "unreadable_time" | "unknown_zone" | "over_limit";

export interface IcsResult {
  events: CalendarEvent[];
  skipped: Record<SkipReason, number>;
  repeating: number;
}

export type IcsProblemCode = "not_calendar" | "too_big";

const PROBLEM_TEXT: Record<IcsProblemCode, string> = {
  not_calendar: "We could not read that file as a calendar.",
  too_big: "That calendar is bigger than 2 MB.",
};

export class IcsProblem extends InputProblem {
  constructor(readonly code: IcsProblemCode) {
    super(PROBLEM_TEXT[code]);
    this.name = "IcsProblem";
  }
}

class Skip extends Error {
  constructor(readonly reason: SkipReason) {
    super(reason);
    this.name = "Skip";
  }
}

interface Parts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
  isDate: boolean;
  utc: boolean;
  tzid: string | undefined;
}

const DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
const DATE_TIME = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(Z?)$/;
const DURATION = /^([+-]?)P(?:(\d+)W)?(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/;

function pad(n: number, width = 2): string {
  return String(n).padStart(width, "0");
}

function rawValue(component: ICAL.Component, name: string): { type: string; value: unknown; tzid: unknown } | null {
  const prop = component.getFirstProperty(name);
  if (!prop) return null;
  return { type: prop.type, value: prop.jCal[3], tzid: prop.getParameter("tzid") };
}

function textOf(component: ICAL.Component, name: string): string | undefined {
  const value = rawValue(component, name)?.value;
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed === "" ? undefined : trimmed.slice(0, MAX_FIELD_CHARS);
}

function realDate(year: number, month: number, day: number): boolean {
  if (year < EARLIEST_YEAR || year > LATEST_YEAR || month < 1 || month > 12 || day < 1) return false;
  return day <= new Date(Date.UTC(year, month, 0)).getUTCDate();
}

function partsOf(component: ICAL.Component, name: string): Parts | null {
  const raw = rawValue(component, name);
  if (!raw) return null;
  if (typeof raw.value !== "string") throw new Skip("unreadable_time");
  const tzid = typeof raw.tzid === "string" ? raw.tzid : undefined;
  const dateOnly = raw.type === "date" ? DATE.exec(raw.value) : null;
  const dateTime = raw.type === "date-time" ? DATE_TIME.exec(raw.value) : null;
  const m = dateOnly ?? dateTime;
  if (!m) throw new Skip("unreadable_time");
  const [year, month, day, hour, minute, second] = [m[1], m[2], m[3], m[4] ?? "0", m[5] ?? "0", m[6] ?? "0"].map(Number);
  if (year === undefined || month === undefined || day === undefined || hour === undefined || minute === undefined || second === undefined) throw new Skip("unreadable_time");
  if (!realDate(year, month, day) || hour > 23 || minute > 59 || second > 59) throw new Skip("unreadable_time");
  return { year, month, day, hour, minute, second, isDate: dateOnly !== null, utc: dateTime?.[7] === "Z", tzid };
}

function localText(p: Parts): string {
  return `${pad(p.year, 4)}-${pad(p.month)}-${pad(p.day)}T${pad(p.hour)}:${pad(p.minute)}:${pad(p.second)}`;
}

function toEventTime(p: Parts): CalendarEventTime {
  if (p.isDate) return { date: `${pad(p.year, 4)}-${pad(p.month)}-${pad(p.day)}` };
  const local = localText(p);
  if (p.utc) return { dateTime: `${local}Z` };
  if (p.tzid === undefined) return { dateTime: local };
  if (!isValidZone(p.tzid)) throw new Skip("unknown_zone");
  return { dateTime: DateTime.fromISO(local, { zone: p.tzid }).toISO({ suppressMilliseconds: true }), timeZone: p.tzid };
}

function durationSeconds(component: ICAL.Component): number | null {
  const raw = rawValue(component, "duration");
  if (!raw || raw.type !== "duration" || typeof raw.value !== "string") return null;
  const m = DURATION.exec(raw.value);
  if (!m || raw.value === "P" || raw.value.endsWith("T")) return null;
  const [weeks, days, hours, minutes, seconds] = [m[2], m[3], m[4], m[5], m[6]].map((x) => Number(x ?? 0));
  const total = (weeks ?? 0) * 604800 + (days ?? 0) * 86400 + (hours ?? 0) * 3600 + (minutes ?? 0) * 60 + (seconds ?? 0);
  return m[1] === "-" ? -total : total;
}

function endOf(component: ICAL.Component, start: Parts, startTime: CalendarEventTime): CalendarEventTime {
  const end = partsOf(component, "dtend");
  if (end) return toEventTime(end);
  const seconds = durationSeconds(component);
  if (seconds !== null && startTime.dateTime !== undefined && !start.isDate) {
    const base = DateTime.fromISO(startTime.dateTime, startTime.timeZone ? { zone: startTime.timeZone, setZone: true } : { setZone: true });
    return { dateTime: base.plus({ seconds }).toISO({ suppressMilliseconds: true }), ...(startTime.timeZone ? { timeZone: startTime.timeZone } : {}) };
  }
  if (start.isDate) {
    const next = DateTime.fromISO(startTime.date ?? "", { zone: "utc" }).plus({ days: 1 });
    return { date: next.toISODate() };
  }
  return startTime;
}

function toEvent(component: ICAL.Component, calendar: string | undefined): CalendarEvent {
  if (textOf(component, "status")?.toUpperCase() === "CANCELLED") throw new Skip("cancelled");
  if (component.hasProperty("recurrence-id")) throw new Skip("override");
  const start = partsOf(component, "dtstart");
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

function utf8Bytes(text: string): number {
  return text.length * 3 <= MAX_ICS_BYTES ? text.length : new TextEncoder().encode(text).length;
}

function parseRoot(text: string): ICAL.Component {
  try {
    return new ICAL.Component(ICAL.parse(text));
  } catch (e) {
    if (e instanceof Error) throw new IcsProblem("not_calendar");
    throw e;
  }
}

export function parseIcs(text: string, opts: { calendar?: string } = {}): IcsResult {
  if (utf8Bytes(text) > MAX_ICS_BYTES) throw new IcsProblem("too_big");
  const root = parseRoot(text);
  if (root.name !== "vcalendar") throw new IcsProblem("not_calendar");
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
  if (result.events.length === 0 && Object.values(result.skipped).every((n) => n === 0)) throw new IcsProblem("not_calendar");
  return result;
}
