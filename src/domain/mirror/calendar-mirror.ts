import { calendarItems } from "../visibility/calendar-items";
import type { TripView, VisibleItem } from "../visibility/project";
import { clockSentence, flightCities } from "../time/flight-card";
import { formatFlightDuration, toLocal } from "../time/format";

export interface GoogleEventTime {
  dateTime: string;
  timeZone: string;
}

export interface MirrorEvent {
  summary: string;
  description: string;
  location?: string;
  start: GoogleEventTime;
  end: GoogleEventTime;
  transparency: "opaque" | "transparent";
  reminders: { useDefault: false; overrides: [] };
  extendedProperties: { private: { tripPlannerKey: string; tripId: string } };
  source?: { title: string; url: string };
}

export interface DesiredEvent {
  key: string;
  hash: string;
  event: MirrorEvent;
}

export interface MirroredRecord {
  key: string;
  googleEventId: string;
  hash: string;
}

export type MirrorOp =
  | { op: "create"; key: string; hash: string; event: MirrorEvent }
  | { op: "update"; key: string; hash: string; googleEventId: string; event: MirrorEvent }
  | { op: "delete"; key: string; googleEventId: string };

export interface MirrorOptions {
  includeSensitive: boolean;
  appUrl: string;
}

export function stableHash(value: unknown): string {
  const str = JSON.stringify(value);
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < str.length; i++) {
    const ch = str.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36);
}

const googleTime = (t: { at: string; zone: string }): GoogleEventTime => ({
  dateTime: toLocal(t).toISO({ suppressMilliseconds: true }),
  timeZone: t.zone,
});

function summaryFor(item: VisibleItem): string {
  if (item.type === "flight" && item.flight) {
    const { from, to } = flightCities(item);
    return `${item.flight.flightNumber} ${from ?? item.flight.fromAirport} to ${to ?? item.flight.toAirport}`;
  }
  if (item.type === "stay") return `Stay: ${item.title}`;
  return item.title;
}

function descriptionFor(item: VisibleItem, view: TripView, opts: MirrorOptions): string {
  const lines: string[] = [];
  if (item.type === "flight" && item.flight) {
    lines.push([item.flight.airline, item.flight.flightNumber].filter(Boolean).join(" "));
    lines.push(`${item.flight.fromAirport} to ${item.flight.toAirport}, ${formatFlightDuration(item.start, item.end)}.`);
    const clock = clockSentence(item);
    if (clock) lines.push(clock);
  }
  if (item.startIsEstimated || item.endIsEstimated) lines.push("Check in or check out time is estimated.");
  const names = new Map(view.travelers.map((t) => [t.id, t.name]));
  if (item.travelerIds.length) lines.push(`Travelers: ${item.travelerIds.map((id) => names.get(id) ?? "Someone").join(", ")}`);
  if (opts.includeSensitive) {
    for (const p of item.private) {
      const who = p.travelerId ? names.get(p.travelerId) : null;
      const bits = [p.confirmationCode && `Confirmation ${p.confirmationCode}`, p.bookingReference && `Booking ${p.bookingReference}`, p.seat && `Seat ${p.seat}`, p.phone && `Phone ${p.phone}`].filter(Boolean);
      if (bits.length) lines.push(`${who ? `${who}: ` : ""}${bits.join(", ")}`);
    }
  }
  if (item.notes) lines.push("", item.notes);
  lines.push("", `Managed by Trip planner. Changes made here are replaced. Edit in the app: ${opts.appUrl}/trips/${item.tripId}/items/${item.id}`);
  return lines.join("\n");
}

function locationFor(item: VisibleItem): string | undefined {
  if (item.type === "flight" && item.flight) return `${item.flight.fromAirport} airport`;
  return item.location?.address ?? ([item.location?.name, item.location?.city].filter(Boolean).join(", ") || undefined);
}

export function buildMirrorEvents(view: TripView, opts: MirrorOptions): DesiredEvent[] {
  const props = (key: string) => ({ private: { tripPlannerKey: key, tripId: view.trip.id } });
  const events: DesiredEvent[] = calendarItems(view).map((item) => {
    const key = `item:${item.id}`;
    const event: MirrorEvent = {
      summary: summaryFor(item),
      description: descriptionFor(item, view, opts),
      location: locationFor(item),
      start: googleTime(item.start),
      end: googleTime(item.end),
      transparency: item.type === "stay" ? "transparent" : "opaque",
      reminders: { useDefault: false, overrides: [] },
      extendedProperties: props(key),
      source: { title: view.trip.name, url: `${opts.appUrl}/trips/${item.tripId}` },
    };
    return { key, hash: stableHash(event), event };
  });
  const seenBusy = new Set<string>();
  for (const b of view.busy) {
    const key = `busy:${b.start.at}:${b.end.at}`;
    if (seenBusy.has(key)) continue;
    seenBusy.add(key);
    const event: MirrorEvent = {
      summary: "Busy",
      description: "",
      start: googleTime(b.start),
      end: googleTime(b.end),
      transparency: "opaque",
      reminders: { useDefault: false, overrides: [] },
      extendedProperties: props(key),
    };
    events.push({ key, hash: stableHash(event), event });
  }
  return events;
}

export function planMirrorSync(desired: DesiredEvent[], mirrored: MirroredRecord[]): MirrorOp[] {
  const ops: MirrorOp[] = [];
  const have = new Map(mirrored.map((m) => [m.key, m]));
  const want = new Set(desired.map((d) => d.key));
  for (const d of desired) {
    const m = have.get(d.key);
    if (!m) ops.push({ op: "create", key: d.key, hash: d.hash, event: d.event });
    else if (m.hash !== d.hash) ops.push({ op: "update", key: d.key, hash: d.hash, googleEventId: m.googleEventId, event: d.event });
  }
  for (const m of mirrored) if (!want.has(m.key)) ops.push({ op: "delete", key: m.key, googleEventId: m.googleEventId });
  return ops;
}
