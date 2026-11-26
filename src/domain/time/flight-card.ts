import type { Item, Zone } from "../types";

import {
  formatClock,
  formatFlightDuration,
  formatWeekday,
  homeReference,
  localDateKey,
  offsetAt,
  toLocal,
} from "./format";
import { airportByCode, airportShortName, airportsInCity } from "./places";

export type FlightLike = Pick<Item, "id" | "type" | "flight" | "start" | "end">;

export interface FlightEnd {
  time: string;
  city: string;
  airport: string | null;
  place: string;
}

export interface FlightCard {
  header: string;
  dayKey: string;
  depart: FlightEnd;
  duration: string;
  arrive: FlightEnd & { tag: string | null; home: string | null };
  clockSentence: string | null;
}

function placeFor(code: string): { city: string; airport: string | null; place: string } {
  const airport = airportByCode(code);
  if (!airport) return { city: code, airport: null, place: code };
  const label = airportsInCity(airport.city).length > 1 ? airportShortName(airport) : null;
  return { city: airport.city, airport: label, place: label ? `${airport.city}, ${label}` : airport.city };
}

function hoursPhrase(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  const hours = h === 1 ? "1 hour" : `${h} hours`;
  if (m === 0) return hours;
  return h === 0 ? `${m} min` : `${hours} ${m} min`;
}

export function clockSentence(item: Pick<Item, "start" | "end">): string | null {
  const depDate = localDateKey(item.start);
  const arrDate = localDateKey(item.end);
  const parts: string[] = [];
  if (arrDate > depDate) parts.push("Lands the next day.");
  else if (arrDate < depDate) parts.push("Lands the day before.");
  const diff = offsetAt(item.end.zone, item.end.at) - offsetAt(item.start.zone, item.start.at);
  if (diff > 0) parts.push(`Clocks go forward ${hoursPhrase(diff)}.`);
  else if (diff < 0) parts.push(`Clocks go back ${hoursPhrase(-diff)}.`);
  return parts.length ? parts.join(" ") : null;
}

export function arrivalTag(item: Pick<Item, "start" | "end">): string | null {
  const dep = toLocal(item.start);
  const arr = toLocal(item.end);
  if (arr.toISODate() !== dep.toISODate()) return formatWeekday(arr);
  return arr.toFormat("HH:mm") < dep.toFormat("HH:mm") ? "Same day" : null;
}

export function buildFlightCard(item: FlightLike, homeZone: Zone | null): FlightCard {
  if (item.type !== "flight" || !item.flight) throw new Error(`Item ${item.id} is not a flight`);
  const f = item.flight;
  const from = placeFor(f.fromAirport);
  const to = placeFor(f.toAirport);
  return {
    header: [f.flightNumber, f.airline].filter(Boolean).join(" "),
    dayKey: localDateKey(item.start),
    depart: { time: formatClock(toLocal(item.start)), ...from },
    duration: formatFlightDuration(item.start, item.end),
    arrive: {
      time: formatClock(toLocal(item.end)),
      ...to,
      tag: arrivalTag(item),
      home: homeReference(item.end, homeZone),
    },
    clockSentence: clockSentence(item),
  };
}

export function flightCities(item: Pick<Item, "flight">): { from: string | null; to: string | null } {
  if (!item.flight) return { from: null, to: null };
  return {
    from: airportByCode(item.flight.fromAirport)?.city ?? null,
    to: airportByCode(item.flight.toAirport)?.city ?? null,
  };
}
