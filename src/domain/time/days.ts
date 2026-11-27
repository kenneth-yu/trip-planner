import { DateTime } from "./luxon";
import type { BusyBlock, TripView, VisibleItem } from "../visibility/project";
import type { Zone } from "../types";
import { buildFlightCard, flightCities, type FlightCard } from "./flight-card";
import { formatClock, formatDayHeader, homeReference, instantMs, localDateKey, toLocal } from "./format";
import { resolvePlace } from "./resolve-place";

export interface Whereabouts {
  kind: "air" | "ground";
  city: string | null;
  zone: Zone;
}

export function itemCity(item: VisibleItem): string | null {
  if (item.type === "flight") return flightCities(item).to;
  if (item.location?.city) return item.location.city;
  const text = [item.location?.address, item.location?.name].filter(Boolean).join(", ");
  if (!text) return null;
  const r = resolvePlace({ address: text });
  return r.status === "unknown" ? null : r.city;
}

function arrivals(items: VisibleItem[]) {
  return items
    .filter((i) => i.type === "flight" || i.type === "transfer")
    .map((i) => ({
      at: instantMs(i.end),
      zone: i.end.zone,
      city: i.type === "flight" ? flightCities(i).to : (i.transfer?.toPlace?.city ?? itemCity(i)),
    }));
}

export function whereAt(atMs: number, items: VisibleItem[], homeZone: Zone): Whereabouts {
  const flying = items.find((i) => i.type === "flight" && instantMs(i.start) <= atMs && atMs < instantMs(i.end));
  if (flying) return { kind: "air", city: flightCities(flying).from, zone: flying.start.zone };

  const lastArrival = arrivals(items)
    .filter((a) => a.at <= atMs)
    .sort((a, b) => b.at - a.at)[0];
  const stay = items
    .filter((i) => i.type === "stay" && itemCity(i) !== null && instantMs(i.start) <= atMs && atMs < instantMs(i.end))
    .sort((a, b) => instantMs(b.start) - instantMs(a.start))[0];

  if (stay && (!lastArrival || instantMs(stay.start) > lastArrival.at)) {
    return { kind: "ground", city: itemCity(stay), zone: stay.start.zone };
  }
  if (lastArrival) return { kind: "ground", city: lastArrival.city, zone: lastArrival.zone };
  return { kind: "ground", city: null, zone: homeZone };
}

export type DayEntry =
  | { kind: "flight"; at: string; itemId: string; card: FlightCard }
  | { kind: "arrival"; at: string; itemId: string; time: string; text: string }
  | { kind: "in_air"; at: string; itemId: string; text: string }
  | { kind: "check_in" | "check_out"; at: string; itemId: string; time: string; text: string; place: string | null; home: string | null }
  | { kind: "event"; at: string; itemId: string; time: string; title: string; place: string | null; home: string | null; itemType: "plan" | "transfer" }
  | { kind: "busy"; at: string; key: string; time: string };

export interface Day {
  key: string;
  header: string;
  place: string | null;
  entries: DayEntry[];
  isFree: boolean;
}

function placeLine(item: VisibleItem): string | null {
  const city = itemCity(item);
  const name = item.location?.name && item.location.name !== item.title ? item.location.name : null;
  return [name, city].filter(Boolean).join(", ") || null;
}

function entriesFor(item: VisibleItem, tripHomeZone: Zone, homeLabel?: string, withoutHome = false): { day: string; entry: DayEntry }[] {
  const homeZone = withoutHome ? null : tripHomeZone;
  const out: { day: string; entry: DayEntry }[] = [];
  const startDay = localDateKey(item.start);
  const endDay = localDateKey(item.end);
  const startTime = formatClock(toLocal(item.start));
  const endTime = formatClock(toLocal(item.end));

  if (item.type === "flight") {
    out.push({ day: startDay, entry: { kind: "flight", at: item.start.at, itemId: item.id, card: buildFlightCard(item, homeZone, homeLabel) } });
    if (endDay !== startDay) {
      let d = DateTime.fromISO(startDay).plus({ days: 1 });
      while (d.toISODate() < endDay) {
        out.push({ day: d.toISODate(), entry: { kind: "in_air", at: item.start.at, itemId: item.id, text: "In the air for the rest of the day" } });
        d = d.plus({ days: 1 });
      }
      const from = flightCities(item).from;
      out.push({
        day: endDay,
        entry: { kind: "arrival", at: item.end.at, itemId: item.id, time: endTime, text: from ? `Landed from ${from}` : "Landed" },
      });
    }
    return out;
  }

  if (item.type === "stay") {
    const place = itemCity(item);
    out.push({
      day: startDay,
      entry: {
        kind: "check_in", at: item.start.at, itemId: item.id,
        time: startTime,
        text: `${item.startIsEstimated ? `Check in from ${startTime}` : "Check in"}: ${item.title}`,
        place, home: homeReference(item.start, homeZone, homeLabel),
      },
    });
    out.push({
      day: endDay,
      entry: {
        kind: "check_out", at: item.end.at, itemId: item.id,
        time: endTime,
        text: `${item.endIsEstimated ? `Check out by ${endTime}` : "Check out"}: ${item.title}`,
        place, home: homeReference(item.end, homeZone, homeLabel),
      },
    });
    return out;
  }

  out.push({
    day: startDay,
    entry: {
      kind: "event", at: item.start.at, itemId: item.id, time: startTime, title: item.title,
      place: placeLine(item), home: homeReference(item.start, homeZone, homeLabel), itemType: item.type,
    },
  });
  return out;
}

function busyEntry(b: BusyBlock): { day: string; entry: DayEntry } {
  return { day: localDateKey(b.start), entry: { kind: "busy", at: b.start.at, key: b.key, time: formatClock(toLocal(b.start)) } };
}

export function filterByTravelers(items: VisibleItem[], travelerIds?: string[]): VisibleItem[] {
  if (!travelerIds?.length) return items;
  return items.filter((i) => i.travelerIds.some((t) => travelerIds.includes(t)));
}

export function buildDays(view: TripView, opts: { travelerIds?: string[]; homeLabel?: string; homeReferences?: boolean } = {}): Day[] {
  const items = filterByTravelers(view.items, opts.travelerIds);
  const placed = [...items.flatMap((i) => entriesFor(i, view.homeZone, opts.homeLabel, opts.homeReferences === false)), ...view.busy.map(busyEntry)];
  if (!placed.length) return [];

  const keys = placed.map((p) => p.day).sort();
  const first = DateTime.fromISO(keys[0]);
  const last = DateTime.fromISO(keys[keys.length - 1]);
  const byDay = new Map<string, DayEntry[]>();
  for (const p of placed) byDay.set(p.day, [...(byDay.get(p.day) ?? []), p.entry]);

  const days: Day[] = [];
  let zone: Zone = view.homeZone;
  for (let d = first; d <= last; d = d.plus({ days: 1 })) {
    const key = d.toISODate();
    const entries = (byDay.get(key) ?? []).sort((a, b) => {
      if (a.kind === "arrival" && b.kind !== "arrival") return -1;
      if (b.kind === "arrival" && a.kind !== "arrival") return 1;
      return instantMs(a.at) - instantMs(b.at);
    });
    const noon = DateTime.fromISO(`${key}T12:00`, { zone }).toMillis();
    const where = whereAt(noon, items, view.homeZone);
    zone = where.zone;

    const departures = items
      .filter((i) => i.type === "flight" && localDateKey(i.start) === key)
      .sort((a, b) => instantMs(a.start) - instantMs(b.start));
    let place = where.city;
    if (departures.length) {
      const from = flightCities(departures[0]).from;
      const to = flightCities(departures[departures.length - 1]).to;
      place = from && to ? `${from} to ${to}` : place;
    }

    days.push({ key, header: formatDayHeader(d), place, entries, isFree: entries.length === 0 });
  }
  return days;
}

export interface DayGroup {
  key: string;
  keys: string[];
  header: string;
  place: string | null;
  entries: DayEntry[];
  isFree: boolean;
}

export function groupFreeDays(days: Day[]): DayGroup[] {
  const groups: DayGroup[] = [];
  for (const day of days) {
    const last = groups.at(-1);
    if (day.isFree && last?.isFree && last.place === day.place) {
      last.keys.push(day.key);
      last.header = `${last.header.split(" to ")[0]} to ${day.header}`;
      continue;
    }
    groups.push({ key: day.key, keys: [day.key], header: day.header, place: day.place, entries: day.entries, isFree: day.isFree });
  }
  return groups;
}
