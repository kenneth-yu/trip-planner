import { lookupViaCity } from "city-timezones";
import tzlookup from "@photostructure/tz-lookup";
import { getAllCountries } from "countries-and-timezones";
import type { Zone } from "../types";
import { airportsInCity } from "./places";

export interface PlaceQuery {
  city?: string;
  address?: string;
  country?: string;
}

export interface GeoHit {
  lat: number;
  lng: number;
  label: string;
}

export interface ResolveContext {
  contextZone?: Zone | null;
  geocoded?: GeoHit | null;
}

export type PlaceSource = "airport city" | "city" | "country" | "address lookup" | "trip";

export type PlaceResolution =
  | { status: "sure"; zone: Zone; city: string | null; source: PlaceSource }
  | { status: "check"; zone: Zone; city: string | null; source: PlaceSource; reason: string }
  | { status: "unknown"; reason: string };

interface Country {
  code: string;
  name: string;
  zones: string[];
}

interface Candidate {
  zone: Zone;
  city: string;
  countryCode: string;
  population: number;
  source: PlaceSource;
}

const ALIASES: Record<string, string> = {
  usa: "US",
  "united states": "US",
  "united states of america": "US",
  us: "US",
  uk: "GB",
  england: "GB",
  scotland: "GB",
  "great britain": "GB",
  "south korea": "KR",
  korea: "KR",
  "mainland china": "CN",
  prc: "CN",
  "hong kong sar": "HK",
};

const normalize = (s: string) =>
  s
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/[^a-z\s'-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

const countries = new Map<string, Country>();
for (const c of Object.values(getAllCountries())) {
  countries.set(normalize(c.name), { code: c.id, name: c.name, zones: c.timezones });
}
const byCode = new Map([...countries.values()].map((c) => [c.code, c]));
for (const [alias, code] of Object.entries(ALIASES)) {
  const c = byCode.get(code);
  if (c) countries.set(alias, c);
}

function countryNamed(text: string): Country | null {
  return countries.get(normalize(text)) ?? null;
}

function segments(address: string): string[] {
  return address
    .split(/[,\n]/)
    .map((s) => s.replace(/\d[\d-]*/g, " ").replace(/\s+/g, " ").trim())
    .filter((s) => s.length >= 3);
}

function cityCandidates(name: string): Candidate[] {
  const out: Candidate[] = [];
  for (const a of airportsInCity(name)) {
    out.push({ zone: a.zone, city: a.city, countryCode: countryNamed(a.country)?.code ?? a.country, population: Number.MAX_SAFE_INTEGER, source: "airport city" });
  }
  for (const c of lookupViaCity(name)) {
    if (normalize(c.city_ascii) !== normalize(name) && normalize(c.city) !== normalize(name)) continue;
    out.push({ zone: c.timezone, city: c.city_ascii, countryCode: c.iso2, population: c.pop, source: "city" });
  }
  return out;
}

const unique = <T,>(xs: T[]) => [...new Set(xs)];

export function resolvePlace(query: PlaceQuery, ctx: ResolveContext = {}): PlaceResolution {
  const parts = [query.city, ...(query.address ? segments(query.address) : []), query.country].filter((p): p is string => Boolean(p && p.trim()));
  const named = unique(parts.map(countryNamed).filter((c): c is Country => c !== null));
  const cityNames = unique(parts.filter((p) => !countryNamed(p)));

  let candidates = cityNames.flatMap(cityCandidates);
  if (named.length) {
    const codes = new Set(named.map((c) => c.code));
    candidates = candidates.filter((c) => codes.has(c.countryCode));
  }

  if (ctx.geocoded) {
    const zone = tzlookup(ctx.geocoded.lat, ctx.geocoded.lng);
    const agrees = !candidates.length || candidates.some((c) => c.zone === zone);
    const city = query.city ?? candidates[0]?.city ?? null;
    if (agrees) return { status: "sure", zone, city, source: "address lookup" };
    return {
      status: "check",
      zone,
      city,
      source: "address lookup",
      reason: `The address lookup and the city name point to different time zones. We used ${zone.replace(/_/g, " ")}.`,
    };
  }

  const zones = unique(candidates.map((c) => c.zone));
  const label = query.city ?? cityNames[0] ?? "this place";

  if (zones.length === 1) {
    const best = candidates[0];
    const constrained = named.length > 0 || best.source === "airport city";
    if (!constrained && ctx.contextZone && ctx.contextZone !== best.zone) {
      return {
        status: "check",
        zone: ctx.contextZone,
        city: query.city ?? null,
        source: "trip",
        reason: `The only ${label} we know is in ${countryName(best.countryCode)}, far from the rest of the trip, so we used the trip's local time. Add the country to be sure.`,
      };
    }
    return { status: "sure", zone: best.zone, city: best.city, source: best.source };
  }

  if (zones.length > 1) {
    const near = ctx.contextZone ? candidates.find((c) => c.zone === ctx.contextZone) : undefined;
    const pick = near ?? [...candidates].sort((a, b) => b.population - a.population)[0];
    return {
      status: "check",
      zone: pick.zone,
      city: pick.city,
      source: pick.source,
      reason: `There are several places called ${label}. We picked the one in ${countryName(pick.countryCode)}${near ? ", near where you are that day" : ""}. Add the country or state to be sure.`,
    };
  }

  const singleZone = named.find((c) => c.zones.length === 1);
  if (singleZone) return { status: "sure", zone: singleZone.zones[0], city: query.city ?? null, source: "country" };
  if (named.length) return { status: "unknown", reason: `${named[0].name} has more than one time zone, and we could not find ${label} in it. Add the city.` };
  return { status: "unknown", reason: `We could not tell where ${label} is. Add the city and country.` };
}

function countryName(code: string): string {
  return byCode.get(code)?.name ?? code;
}

export interface PlaceContext {
  homeZone: Zone;
  zoneOnDate?: (isoDate: string) => Zone | null;
  geocode?: (query: PlaceQuery) => GeoHit | null;
}

export interface PlacedZone {
  zone: Zone;
  city: string | undefined;
  problem: string | null;
}

export function placeZone(query: PlaceQuery, isoDate: string, ctx: PlaceContext): PlacedZone {
  const contextZone = ctx.zoneOnDate?.(isoDate) ?? null;
  const r = resolvePlace(query, { contextZone, geocoded: ctx.geocode?.(query) ?? null });
  if (r.status === "sure") return { zone: r.zone, city: r.city ?? query.city, problem: null };
  if (r.status === "check") return { zone: r.zone, city: r.city ?? query.city, problem: r.reason };
  const fallback = contextZone ?? ctx.homeZone;
  return {
    zone: fallback,
    city: query.city,
    problem: `${r.reason} Times use ${contextZone ? "the trip's local time that day" : "your home time"} until then.`,
  };
}
