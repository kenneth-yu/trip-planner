import { DateTime } from "../time/luxon";
import type { ItemPrivate, Zone, ZonedTime } from "../types";
import { fromLocal, isValidZone } from "../time/format";
import { airportZone } from "../time/places";
import { placeZone, resolvePlace, type PlaceContext } from "../time/resolve-place";
import {
  extractDeadlines,
  extractFlightNumber,
  extractLateArrivalCutoff,
  extractPrivate,
  extractRoute,
  extractStayTimes,
} from "./patterns";
import type { ProposedItem } from "./proposal";
import { InputProblem } from "./problem";

export interface CalendarEventTime {
  dateTime?: string;
  date?: string;
  timeZone?: string;
}

export interface CalendarEvent {
  id?: string;
  calendar?: string;
  summary?: string;
  description?: string;
  location?: string;
  htmlLink?: string;
  start: CalendarEventTime;
  end: CalendarEventTime;
}

export interface MapContext extends PlaceContext {
  travelerIds: string[];
}

export interface MappedEvent {
  proposed: ProposedItem;
  unparsed: string[];
}

export const DEFAULT_CHECK_IN = "15:00";
export const DEFAULT_CHECK_OUT = "11:00";

type TimedEvent = CalendarEvent & { start: { dateTime: string; timeZone?: string }; end: { dateTime: string } };
type AllDayEvent = CalendarEvent & { start: { date: string }; end: { date: string } };

function isAllDay(ev: CalendarEvent): ev is AllDayEvent {
  return typeof ev.start.date === "string" && typeof ev.end.date === "string";
}

function isTimed(ev: CalendarEvent): ev is TimedEvent {
  return typeof ev.start.dateTime === "string" && typeof ev.end.dateTime === "string";
}

const HAS_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/;
const HAS_OFFSET = /(?:Z|[+-]\d{2}(?::?\d{2})?)$/i;
const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;
const EARLIEST_YEAR = 1970;
const LATEST_YEAR = 2100;

function unreadable(which: string): InputProblem {
  return new InputProblem(`The ${which} of this event is not a date we can read.`);
}

function checkedYear(dt: DateTime, which: string): DateTime {
  if (dt.year < EARLIEST_YEAR || dt.year > LATEST_YEAR) throw unreadable(which);
  return dt;
}

function readDateTime(text: string, which: string, floatingZone: Zone): DateTime {
  if (!HAS_TIME.test(text)) throw unreadable(which);
  try {
    const dt = HAS_OFFSET.test(text) ? DateTime.fromISO(text, { setZone: true }) : DateTime.fromISO(text, { zone: floatingZone });
    return checkedYear(dt, which);
  } catch (e) {
    if (e instanceof InputProblem) throw e;
    throw unreadable(which);
  }
}

function readDate(text: string, which: string): DateTime {
  if (!DATE_ONLY.test(text)) throw unreadable(which);
  try {
    return checkedYear(DateTime.fromISO(text, { zone: "utc" }), which);
  } catch (e) {
    if (e instanceof InputProblem) throw e;
    throw unreadable(which);
  }
}

function instant(t: { dateTime: string }, which: string, zone: Zone): ZonedTime {
  return { at: readDateTime(t.dateTime, which, zone).toUTC().toISO(), zone };
}

function validZoneOr(zone: string | undefined, fallback: Zone): Zone {
  return zone !== undefined && isValidZone(zone) ? zone : fallback;
}

function endsBeforeStart(start: ZonedTime, end: ZonedTime, problems: string[]) {
  if (Date.parse(end.at) < Date.parse(start.at)) problems.push("This ends before it starts. Check both times.");
}

function privateFor(text: string, travelerIds: string[]): ItemPrivate[] {
  const p = { ...extractPrivate(text), ...(text ? { notes: text } : {}) };
  if (!Object.keys(p).length) return [];
  return [{ travelerId: travelerIds.length === 1 ? travelerIds[0] : null, ...p }];
}

function splitCity(summary: string): { title: string; city: string | null } {
  const m = /^(.*?)\s*\(([^)]+)\)\s*$/.exec(summary);
  if (m && resolvePlace({ city: m[2] }).status !== "unknown") return { title: m[1], city: m[2] };
  return { title: summary, city: null };
}

function mapFlight(ev: TimedEvent, flightNumber: string, ctx: MapContext): MappedEvent {
  const summary = ev.summary ?? "";
  const desc = ev.description ?? "";
  const { from, to } = extractRoute(summary, ev.location ?? "", desc);
  const problems: string[] = [];
  const fallback = validZoneOr(ev.start.timeZone, ctx.homeZone);
  const fromZone = from ? airportZone(from) : null;
  const toZone = to ? airportZone(to) : null;
  if (!fromZone) problems.push("Which airport does this flight leave from?");
  if (!toZone) problems.push("Which airport does this flight land at?");
  const start = instant(ev.start, "start", fromZone ?? fallback);
  const end = instant(ev.end, "end", toZone ?? fallback);
  endsBeforeStart(start, end, problems);
  const notAfter = DateTime.fromISO(start.at).setZone(start.zone);
  const { deadlines, unparsed } = extractDeadlines(desc, start.zone, notAfter);
  return {
    proposed: {
      type: "flight",
      title: flightNumber,
      start,
      end,
      startIsEstimated: false,
      endIsEstimated: false,
      location: null,
      flight: { flightNumber, fromAirport: from ?? "", toAirport: to ?? "", airline: airlineBefore(desc, flightNumber) },
      travelerIds: ctx.travelerIds,
      private: privateFor(desc, ctx.travelerIds),
      deadlines: deadlines.map((d) => ({ kind: d.kind, at: fromLocal(d.local, d.zone), consequence: d.consequence, source: "parsed" as const })),
      notes: "",
      status: problems.length || !desc ? "needs_review" : "confirmed",
      problems,
    },
    unparsed,
  };
}

function mapAllDay(ev: AllDayEvent, ctx: MapContext): MappedEvent {
  const summary = ev.summary ?? "Untitled";
  const desc = ev.description ?? "";
  const { title, city: titleCity } = splitCity(summary);
  const problems: string[] = [];
  const startDay = readDate(ev.start.date, "start");
  const endDay = readDate(ev.end.date, "end");
  const placed = placeZone({ city: titleCity ?? undefined, address: ev.location || undefined }, startDay.toISODate(), ctx);
  if (placed.problem) problems.push(placed.problem);
  const zone = placed.zone;
  const city = placed.city ?? null;
  const nights = endDay.diff(startDay, "days").days;
  const isStay = nights >= 1;
  const times = extractStayTimes(desc);
  const start = fromLocal(`${ev.start.date}T${times.checkIn ?? DEFAULT_CHECK_IN}`, zone);
  const end = fromLocal(`${ev.end.date}T${times.checkOut ?? DEFAULT_CHECK_OUT}`, zone);
  endsBeforeStart(start, end, problems);
  const { deadlines, unparsed } = extractDeadlines(desc, zone, DateTime.fromISO(start.at).setZone(zone));
  const kind = /airbnb|vrbo|apartment/i.test(summary) ? "rental" : /hotel|inn|hostel|resort|ryokan/i.test(summary) ? "hotel" : "other";
  return {
    proposed: {
      type: isStay ? "stay" : "plan",
      title,
      start,
      end,
      startIsEstimated: !times.checkIn,
      endIsEstimated: !times.checkOut,
      location: { name: title, address: ev.location || undefined, city: city ?? undefined },
      stay: isStay ? { propertyName: title, kind, lateArrivalCutoff: extractLateArrivalCutoff(desc) ?? undefined } : undefined,
      travelerIds: ctx.travelerIds,
      private: privateFor(desc, ctx.travelerIds),
      deadlines: deadlines.map((d) => ({ kind: d.kind, at: fromLocal(d.local, d.zone), consequence: d.consequence, source: "parsed" as const })),
      notes: "",
      status: problems.length || !desc ? "needs_review" : "confirmed",
      problems,
    },
    unparsed,
  };
}

function mapTimed(ev: TimedEvent, ctx: MapContext): MappedEvent {
  const summary = ev.summary ?? "Untitled";
  const desc = ev.description ?? "";
  const problems: string[] = [];
  const calendarZone = ev.start.timeZone && isValidZone(ev.start.timeZone) ? ev.start.timeZone : null;
  const localDate = readDateTime(ev.start.dateTime, "start", "utc").toISODate();
  if (ev.start.timeZone && !calendarZone) problems.push("The calendar gave a time zone we do not recognise.");
  let zone: Zone;
  let city: string | undefined;
  if (ev.location) {
    const r = resolvePlace({ address: ev.location }, { contextZone: ctx.zoneOnDate?.(localDate) ?? null, geocoded: ctx.geocode?.({ address: ev.location }) ?? null });
    if (r.status === "unknown") {
      zone = calendarZone ?? ctx.zoneOnDate?.(localDate) ?? ctx.homeZone;
      problems.push(`${r.reason} We used ${calendarZone ? "the calendar event's time zone" : "the trip's local time"} until then.`);
    } else {
      zone = r.zone;
      city = r.city ?? undefined;
      if (r.status === "check") problems.push(r.reason);
    }
  } else if (calendarZone) {
    zone = calendarZone;
  } else {
    zone = ctx.zoneOnDate?.(localDate) ?? ctx.homeZone;
    problems.push("Where is this? No place or time zone came with it.");
  }
  const start = instant(ev.start, "start", zone);
  const end = instant(ev.end, "end", zone);
  endsBeforeStart(start, end, problems);
  const { deadlines, unparsed } = extractDeadlines(desc, zone, DateTime.fromISO(start.at).setZone(zone));
  const name = ev.location?.split(",")[0]?.trim();
  return {
    proposed: {
      type: "plan",
      title: summary,
      start,
      end,
      startIsEstimated: false,
      endIsEstimated: false,
      location: ev.location ? { name, address: ev.location, city } : null,
      travelerIds: ctx.travelerIds,
      private: privateFor(desc, ctx.travelerIds),
      deadlines: deadlines.map((d) => ({ kind: d.kind, at: fromLocal(d.local, d.zone), consequence: d.consequence, source: "parsed" as const })),
      notes: "",
      status: problems.length ? "needs_review" : "confirmed",
      problems,
    },
    unparsed,
  };
}

export function mapCalendarEvent(ev: CalendarEvent, ctx: MapContext): MappedEvent {
  if (isAllDay(ev)) return mapAllDay(ev, ctx);
  if (!isTimed(ev)) throw new InputProblem("This event has no usable start and end.");
  const flightNumber = extractFlightNumber(ev.summary ?? "") ?? extractFlightNumber(ev.description ?? "");
  const looksLikeFlight = flightNumber && (/flight|→|->|\bto\b/i.test(ev.summary ?? "") || /airport|\([A-Z]{3}\)|\b[A-Z]{3}\b/.test(ev.location ?? ""));
  if (flightNumber && looksLikeFlight) return mapFlight(ev, flightNumber, ctx);
  return mapTimed(ev, ctx);
}

export function airlineBefore(text: string, flightNumber: string): string | undefined {
  const code = flightNumber.slice(0, 2);
  const num = flightNumber.slice(2);
  const m = new RegExp(`\\b((?:[A-Z][A-Za-z]+ ){0,2}[A-Z][A-Za-z]+)\\s+${code}\\s?${num}\\b`).exec(text);
  if (!m) return undefined;
  return m[1].replace(/^(?:Flight|Departs|Arrives|On)\s+/, "") || undefined;
}
