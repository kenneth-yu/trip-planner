import { airports as rawAirports } from "@nwpr/airport-codes";
import { z } from "zod";
import type { Zone } from "../types";

export interface Airport {
  iata: string;
  name: string;
  city: string;
  country: string;
  zone: Zone;
  longitude: number | null;
}

const RawAirport = z.object({
  iata: z.string().nullish(),
  name: z.string().optional(),
  city: z.string().optional(),
  country: z.string().optional(),
  tz: z.string().optional(),
  longitude: z.number().optional(),
});

const byIata = new Map<string, Airport>();
const byCity = new Map<string, Airport[]>();

for (const a of z.array(RawAirport).parse(rawAirports)) {
  if (!a.iata || !a.tz || !a.city || a.tz === "\\N") continue;
  if (/heliport/i.test(a.name ?? "")) continue;
  const airport: Airport = {
    iata: a.iata.toUpperCase(),
    name: a.name ?? a.iata,
    city: a.city,
    country: a.country ?? "",
    zone: a.tz,
    longitude: a.longitude ?? null,
  };
  byIata.set(airport.iata, airport);
  const cityKey = normalize(airport.city);
  byCity.set(cityKey, [...(byCity.get(cityKey) ?? []), airport]);
}

function normalize(s: string): string {
  return s.trim().toLowerCase().replace(/\s+/g, " ");
}

export function airportByCode(code: string): Airport | null {
  return byIata.get(code.trim().toUpperCase()) ?? null;
}

export function airportZone(code: string): Zone | null {
  return airportByCode(code)?.zone ?? null;
}

export function cityZone(city: string): Zone | null {
  const list = byCity.get(normalize(city));
  if (!list?.length) return null;
  const zones = new Set(list.map((a) => a.zone));
  return zones.size === 1 ? list[0].zone : null;
}

export function airportsInCity(city: string): Airport[] {
  return byCity.get(normalize(city)) ?? [];
}

export function airportShortName(airport: Airport): string {
  const cityWords = new Set(normalize(airport.city).split(" "));
  const words = airport.name
    .replace(/[()]/g, " ")
    .split(/\s+/)
    .filter(Boolean)
    .filter((w) => !/^(international|intl|airport|airfield)$/i.test(w))
    .filter((w) => !cityWords.has(w.toLowerCase()));
  return words.length === 1 ? words[0] : airport.iata;
}

export function airportByName(fragment: string): Airport | null {
  const f = normalize(fragment);
  if (f.length < 4 || byCity.has(f)) return null;
  const matches = [...byIata.values()].filter((a) =>
    normalize(a.name).split(/[^a-z']+/).includes(f),
  );
  return matches.length === 1 ? matches[0] : null;
}

