import { DEADLINE_PHRASE } from "../deadlines/deadlines";
import { buildFlightCard } from "../time/flight-card";
import { formatClock, instantMs, toLocal } from "../time/format";
import { itemHeading } from "../time/item-heading";
import { DateTime } from "../time/luxon";
import type { Zone, ZonedTime } from "../types";
import { calendarItems } from "../visibility/calendar-items";
import type { TripView, VisibleItem } from "../visibility/project";

export interface FeedOptions {
  appUrl: string;
  generatedAt: Date;
}

const DEADLINE_MINUTES = 15;
const DAY_MS = 86_400_000;
const PRODUCT = "-//Trip planner//Calendar subscription//EN";
const UID_DOMAIN = "trip-planner";

function escapeText(text: string): string {
  return text
    .replace(/\r\n|[\r\u0085\u2028\u2029]/g, "\n")
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "")
    .replace(/\\/g, "\\\\")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,")
    .replace(/\n/g, "\\n");
}

function fold(line: string): string[] {
  const out: string[] = [];
  let current = "";
  let bytes = 0;
  for (const char of line) {
    const size = new TextEncoder().encode(char).length;
    const limit = out.length === 0 ? 75 : 74;
    if (bytes + size > limit) {
      out.push(current);
      current = "";
      bytes = 0;
    }
    current += char;
    bytes += size;
  }
  out.push(current);
  return out.map((part, index) => (index === 0 ? part : ` ${part}`));
}

function stamp(date: Date): string {
  return date.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
}

const localStamp = (dt: DateTime) => dt.toFormat("yyyyLLdd'T'HHmmss");
const dateStamp = (dt: DateTime) => dt.toFormat("yyyyLLdd");

function offsetText(minutes: number): string {
  const sign = minutes < 0 ? "-" : "+";
  const abs = Math.abs(minutes);
  return `${sign}${String(Math.floor(abs / 60)).padStart(2, "0")}${String(abs % 60).padStart(2, "0")}`;
}

function hash(text: string): string {
  let h = 0xdeadbeef;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 2654435761);
  return (h >>> 0).toString(36);
}

function transitionBetween(zone: Zone, fromMs: number, toMs: number): number {
  let low = fromMs;
  let high = toMs;
  const offsetAt = (ms: number) => DateTime.fromMillis(ms, { zone }).offset;
  const before = offsetAt(low);
  while (high - low > 1000) {
    const mid = Math.floor((low + high) / 2);
    if (offsetAt(mid) === before) low = mid;
    else high = mid;
  }
  return Math.round(high / 60_000) * 60_000;
}

function timezoneLines(zone: Zone, fromMs: number, toMs: number): string[] {
  const at = (ms: number) => DateTime.fromMillis(ms, { zone });
  const first = at(fromMs);
  const observance = (kind: "STANDARD" | "DAYLIGHT", startLocal: string, from: number, to: number, name: string) => [
    `BEGIN:${kind}`,
    `DTSTART:${startLocal}`,
    `TZOFFSETFROM:${offsetText(from)}`,
    `TZOFFSETTO:${offsetText(to)}`,
    `TZNAME:${name}`,
    `END:${kind}`,
  ];
  const lines = [
    "BEGIN:VTIMEZONE",
    `TZID:${zone}`,
    ...observance(first.isInDST ? "DAYLIGHT" : "STANDARD", "19700101T000000", first.offset, first.offset, first.offsetNameShort ?? zone),
  ];
  for (let ms = fromMs; ms < toMs; ms += DAY_MS) {
    const next = Math.min(ms + DAY_MS, toMs);
    const a = at(ms);
    const b = at(next);
    if (a.offset === b.offset) continue;
    const moment = transitionBetween(zone, ms, next);
    const local = DateTime.fromMillis(moment, { zone: "utc" }).plus({ minutes: a.offset });
    lines.push(...observance(b.isInDST ? "DAYLIGHT" : "STANDARD", localStamp(local), a.offset, b.offset, b.offsetNameShort ?? zone));
  }
  lines.push("END:VTIMEZONE");
  return lines;
}

interface Event {
  uid: string;
  summary: string;
  start: ZonedTime | { date: string };
  end: ZonedTime | { date: string };
  location?: string;
  description?: string;
  busy?: boolean;
}

function isDate(value: ZonedTime | { date: string }): value is { date: string } {
  return "date" in value;
}

function placeText(item: VisibleItem): string | undefined {
  if (item.type === "flight" && item.flight) {
    const card = buildFlightCard(item, null);
    return card.depart.place;
  }
  const loc = item.location;
  return loc?.address ?? ((loc ? [loc.name, loc.city].filter(Boolean).join(", ") : "") || undefined);
}

function itemLink(item: VisibleItem, appUrl: string): string {
  return `Open in Trip planner: ${appUrl}/trips/${item.tripId}/items/${item.id}`;
}

function clockOf(time: ZonedTime): string {
  return formatClock(toLocal(time));
}

function stayDescription(item: VisibleItem): string {
  const checkIn = `Check in from ${clockOf(item.start)}${item.startIsEstimated ? " (estimated)" : ""}.`;
  const checkOut = `Check out by ${clockOf(item.end)}${item.endIsEstimated ? " (estimated)" : ""}.`;
  return `${checkIn} ${checkOut}`;
}

function flightDescription(item: VisibleItem, appUrl: string): string {
  const lines: string[] = [];
  if (item.type === "flight" && item.flight) {
    const arrive = buildFlightCard(item, null).arrive;
    lines.push(`Lands ${arrive.time} ${arrive.city} time${arrive.airport ? `, ${arrive.airport}` : ""}.`);
  }
  lines.push(itemLink(item, appUrl));
  return lines.join("\n");
}

function eventsFor(view: TripView, opts: FeedOptions): Event[] {
  const events: Event[] = [];
  const booked = calendarItems(view);
  for (const item of booked) {
    const uid = `item-${item.id}@${UID_DOMAIN}`;
    if (item.type === "stay") {
      const start = toLocal(item.start);
      const end = toLocal(item.end);
      const endDate = dateStamp(end) > dateStamp(start) ? dateStamp(end) : dateStamp(start.plus({ days: 1 }));
      events.push({ uid, summary: item.stay?.propertyName ?? item.title, start: { date: dateStamp(start) }, end: { date: endDate }, location: placeText(item), description: stayDescription(item) });
      continue;
    }
    events.push({
      uid,
      summary: itemHeading(item),
      start: item.start,
      end: item.end,
      location: placeText(item),
      description: item.type === "flight" ? flightDescription(item, opts.appUrl) : itemLink(item, opts.appUrl),
    });
  }
  for (const block of view.busy) {
    events.push({ uid: `busy-${hash(`${block.start.at}|${block.end.at}`)}@${UID_DOMAIN}`, summary: "Busy", start: block.start, end: block.end, busy: true });
  }
  if (view.permissions.canSeeDeadlines) {
    for (const item of booked) {
      for (const deadline of item.deadlines) {
        const end: ZonedTime = { at: new Date(instantMs(deadline.at) + DEADLINE_MINUTES * 60_000).toISOString(), zone: deadline.at.zone };
        events.push({
          uid: `deadline-${deadline.id}@${UID_DOMAIN}`,
          summary: `${item.stay?.propertyName ?? item.title} ${DEADLINE_PHRASE[deadline.kind]}`,
          start: deadline.at,
          end,
          description: `Open in Trip planner: ${opts.appUrl}/trips/${item.tripId}/deadlines`,
        });
      }
    }
  }
  return events;
}

function eventLines(event: Event, stampedAt: string): string[] {
  const lines = ["BEGIN:VEVENT", `UID:${event.uid}`, `DTSTAMP:${stampedAt}`];
  const when = (name: "DTSTART" | "DTEND", value: ZonedTime | { date: string }) => {
    if (isDate(value)) lines.push(`${name};VALUE=DATE:${value.date}`);
    else lines.push(`${name};TZID=${value.zone}:${localStamp(toLocal(value))}`);
  };
  when("DTSTART", event.start);
  when("DTEND", event.end);
  lines.push(`SUMMARY:${escapeText(event.summary)}`);
  if (event.location) lines.push(`LOCATION:${escapeText(event.location)}`);
  if (event.description) lines.push(`DESCRIPTION:${escapeText(event.description)}`);
  if (event.busy) lines.push("CLASS:PRIVATE");
  lines.push(isDate(event.start) && !event.busy ? "TRANSP:TRANSPARENT" : "TRANSP:OPAQUE", "END:VEVENT");
  return lines;
}

function zonesOf(events: Event[]): Map<Zone, { from: number; to: number }> {
  const zones = new Map<Zone, { from: number; to: number }>();
  const note = (time: ZonedTime) => {
    const ms = instantMs(time);
    const seen = zones.get(time.zone);
    zones.set(time.zone, { from: Math.min(seen?.from ?? ms, ms), to: Math.max(seen?.to ?? ms, ms) });
  };
  for (const event of events) {
    if (!isDate(event.start)) note(event.start);
    if (!isDate(event.end)) note(event.end);
  }
  return zones;
}

export function buildFeed(view: TripView, opts: FeedOptions): string {
  const events = eventsFor(view, { ...opts, appUrl: opts.appUrl.replace(/\/+$/, "") });
  const stampedAt = stamp(opts.generatedAt);
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    `PRODID:${PRODUCT}`,
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    `X-WR-CALNAME:${escapeText(view.trip.name)}`,
    "REFRESH-INTERVAL;VALUE=DURATION:PT1H",
    "X-PUBLISHED-TTL:PT1H",
  ];
  for (const [zone, span] of zonesOf(events)) lines.push(...timezoneLines(zone, span.from - 2 * DAY_MS, span.to + 2 * DAY_MS));
  for (const event of events) lines.push(...eventLines(event, stampedAt));
  lines.push("END:VCALENDAR");
  return `${lines.flatMap(fold).join("\r\n")}\r\n`;
}
