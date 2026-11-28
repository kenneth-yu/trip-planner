import { DateTime } from "../time/luxon";
import type { Zone, ZonedTime } from "../types";
import type { TripView, VisibleItem } from "../visibility/project";
import { nightStatuses, type NightStatus } from "../checks/checks";
import { flightCities } from "../time/flight-card";
import { formatClockExact, instantMs, localDateKey, toLocal } from "../time/format";
import { airportByCode } from "../time/places";

const HOUR = 3600_000;
const MINUTE = 60_000;
const BED_TIME = "23:30";
const INTERNATIONAL_EXIT_MS = 90 * MINUTE;
const DOMESTIC_EXIT_MS = 45 * MINUTE;
const INTERNATIONAL_LEAD_MS = 3 * HOUR;
const DOMESTIC_LEAD_MS = 2 * HOUR;
const USUAL_CHECK_IN = "3:00pm";
const USUAL_CHECK_OUT = { hour: 11, label: "11:00am" };
const LONG_GAP_MS = 2 * HOUR;
const CROSSES_MIDNIGHT_BEFORE_HOUR = 6;
const EARLY_ARRIVAL_BEFORE_HOUR = 11;
const VERY_EARLY_LEAVE_BEFORE_HOUR = 5;

export interface SleepStretch {
  city: string;
  zone: Zone;
  nights: string[];
  checkIn: string;
  checkOut: string;
  title: string;
  datesLine: string;
  arrivalLine: string | null;
  departureLine: string | null;
  warnings: string[];
}

export interface SkippedNight {
  night: string;
  reason: "overnight_flight" | "date_line";
  flightId: string;
  lands: ZonedTime;
  landsIsEstimated: boolean;
  landsCity: string | null;
  line: string;
  explanation: string;
}

export type SleepEntry = ({ kind: "stretch" } & SleepStretch) | ({ kind: "plane" } & SkippedNight);

export interface SleepPlan {
  stretches: SleepStretch[];
  planeNights: SkippedNight[];
  entries: SleepEntry[];
  summary: SleepSummary | null;
}

type Leg = VisibleItem;

const byStart = (a: VisibleItem, b: VisibleItem) => instantMs(a.start) - instantMs(b.start);
const dayLabel = (date: string) => DateTime.fromISO(date).toFormat("ccc LLL d", { locale: "en-US" });
const zonePlace = (zone: Zone) => (zone.split("/").pop() ?? zone).replace(/_/g, " ");

function isDomestic(item: VisibleItem): boolean {
  const from = airportByCode(item.flight?.fromAirport ?? "");
  const to = airportByCode(item.flight?.toAirport ?? "");
  return Boolean(from && to && from.country === to.country);
}

function destinationCity(leg: Leg): string | null {
  if (leg.type === "flight") return flightCities(leg).to;
  return leg.transfer?.toPlace?.city ?? null;
}

function homeBracket(t: ZonedTime, homeZone: Zone): string {
  if (t.zone === homeZone) return "";
  const local = toLocal(t);
  const home = toLocal({ at: t.at, zone: homeZone });
  const weekday = home.toISODate() === local.toISODate() ? "" : ` ${home.toFormat("ccc", { locale: "en-US" })}`;
  return ` (${formatClockExact(home)}${weekday} ${zonePlace(homeZone)})`;
}

function timeLine(verb: string, t: ZonedTime, place: string, homeZone: Zone, estimated: boolean): string {
  const local = toLocal(t);
  return `${verb} ${dayLabel(local.toISODate())}, ${estimated ? "about " : ""}${formatClockExact(local)} ${place} time${homeBracket(t, homeZone)}.`;
}

export interface SleepSummary {
  nights: number;
  checkIn: string;
  checkOut: string;
  cities: string[];
  heading: string;
  stretchLines: { city: string; checkIn: string; checkOut: string; line: string }[];
  hints: NightHint[];
  moreHints: number;
  nightNotes: string[];
}

export interface NightHint {
  text: string;
  why: string;
}

const LONG_FLIGHT_MS = 6 * HOUR;

function groupOpenNights(statuses: NightStatus[], landingDate: string): NightStatus[][] {
  const open = statuses.filter((n) => n.state === "open" && n.city !== null && n.night >= landingDate);
  const groups: NightStatus[][] = [];
  for (const n of open) {
    const last = groups.at(-1)?.at(-1);
    const continues = last !== undefined && last.city === n.city && DateTime.fromISO(last.night).plus({ days: 1 }).toISODate() === n.night;
    if (continues) groups.at(-1)?.push(n);
    else groups.push([n]);
  }
  return groups;
}

function bedMs(night: string, zone: Zone): number {
  return DateTime.fromISO(`${night}T${BED_TIME}`, { zone }).toMillis();
}

function buildStretch(group: NightStatus[], legs: Leg[], homeZone: Zone, statuses: NightStatus[], floor: string): SleepStretch {
  const city = group[0].city ?? "";
  const zone = group[0].zone;
  const first = group[0].night;
  const last = group[group.length - 1].night;
  const arrival = legs
    .filter((l) => instantMs(l.end) <= bedMs(first, zone) && destinationCity(l) === city)
    .sort((a, b) => instantMs(b.end) - instantMs(a.end))[0];
  const departure = legs.filter((l) => instantMs(l.start) >= bedMs(last, zone)).sort(byStart)[0];

  const warnings: string[] = [];
  let nights = group.map((n) => n.night);

  if (arrival?.type === "flight") {
    const ready = instantMs(arrival.end) + (isDomestic(arrival) ? DOMESTIC_EXIT_MS : INTERNATIONAL_EXIT_MS);
    const readyLocal = DateTime.fromMillis(ready, { zone });
    const readyDate = readyLocal.toISODate();
    if (readyLocal.hour < CROSSES_MIDNIGHT_BEFORE_HOUR) {
      const before = readyLocal.minus({ days: 1 }).toISODate();
      if (before < first && before > floor && statuses.some((n) => n.night === before && n.state !== "covered")) nights = [before, ...nights];
      warnings.push(`You get there around ${formatClockExact(readyLocal)} on ${dayLabel(readyDate)}. Book from the night of ${dayLabel(before)}, so the room is yours when you arrive.`);
    } else if (readyLocal.hour < EARLY_ARRIVAL_BEFORE_HOUR && readyDate === first) {
      warnings.push(`You get there around ${formatClockExact(readyLocal)}, well before the usual ${USUAL_CHECK_IN} check-in. Ask for an early check-in, or book the night before so the room is ready.`);
    }
  }

  const checkIn = nights[0];
  const checkOut = DateTime.fromISO(last).plus({ days: 1 }).toISODate();

  if (departure?.type === "flight") {
    const lead = isDomestic(departure) ? DOMESTIC_LEAD_MS : INTERNATIONAL_LEAD_MS;
    const leave = instantMs(departure.start) - lead;
    const leaveLocal = DateTime.fromMillis(leave, { zone: departure.start.zone });
    const checkOutAt = DateTime.fromISO(`${checkOut}T${String(USUAL_CHECK_OUT.hour).padStart(2, "0")}:00`, { zone: departure.start.zone }).toMillis();
    if (leaveLocal.hour < VERY_EARLY_LEAVE_BEFORE_HOUR) {
      warnings.push(`You leave for the airport around ${formatClockExact(leaveLocal)}. Stay near the airport the last night, or check the hotel's front desk hours.`);
    } else if (leave - checkOutAt >= LONG_GAP_MS) {
      const hours = Math.round((leave - checkOutAt) / HOUR);
      warnings.push(`Check-out is usually ${USUAL_CHECK_OUT.label} and you leave for the airport around ${formatClockExact(leaveLocal)}. Ask for a late check-out, or plan ${hours} hours with your bags.`);
    }
  }

  return {
    city,
    zone,
    nights,
    checkIn,
    checkOut,
    title: `${city}, ${nights.length} ${nights.length === 1 ? "night" : "nights"}`,
    datesLine: `Check in ${dayLabel(checkIn)}, check out ${dayLabel(checkOut)}`,
    arrivalLine: arrival ? timeLine(arrival.type === "flight" ? "You land" : "You arrive", arrival.end, city, homeZone, arrival.endIsEstimated) : null,
    departureLine: departure ? timeLine(departure.type === "flight" ? "You fly out" : "You leave", departure.start, city, homeZone, departure.startIsEstimated) : null,
    warnings: warnings.slice(0, 2),
  };
}

function planeNightsOf(flights: VisibleItem[], statuses: NightStatus[], inStretch: Set<string>, homeZone: Zone): SkippedNight[] {
  const covered = new Set(statuses.filter((n) => n.state === "covered").map((n) => n.night));
  const out = new Map<string, SkippedNight>();
  for (const flight of flights) {
    const departs = localDateKey(flight.start);
    const days = DateTime.fromISO(localDateKey(flight.end)).diff(DateTime.fromISO(departs), "days").days;
    const place = flightCities(flight).to ?? zonePlace(flight.end.zone);
    for (let i = 0; i < days; i++) {
      const night = DateTime.fromISO(departs).plus({ days: i }).toISODate();
      if (inStretch.has(night) || covered.has(night) || out.has(night)) continue;
      out.set(night, {
        night,
        reason: days >= 2 ? "date_line" : "overnight_flight",
        flightId: flight.id,
        lands: flight.end,
        landsIsEstimated: flight.endIsEstimated,
        landsCity: flightCities(flight).to,
        line: `${dayLabel(night)}: on the plane. No bed needed.`,
        explanation: timeLine("You are on the plane overnight and land", flight.end, place, homeZone, flight.endIsEstimated),
      });
    }
  }
  return [...out.values()].sort((x, y) => x.night.localeCompare(y.night));
}

function clockAt(t: ZonedTime, estimated: boolean): string {
  return `${estimated ? "about " : ""}${formatClockExact(toLocal(t))}`;
}

function listOf(names: string[]): string {
  return names.length === 1 ? names[0] : `${names.slice(0, -1).join(", ")} or ${names[names.length - 1]}`;
}

interface FlightNote {
  hint: NightHint | null;
  coming: string | null;
}

function noteFor(f: VisibleItem, inStretch: Set<string>, homeCities: Set<string>, homeZone: Zone): FlightNote | null {
  const departs = localDateKey(f.start);
  const lands = localDateKey(f.end);
  const days = DateTime.fromISO(lands).diff(DateTime.fromISO(departs), "days").days;
  const from = flightCities(f).from ?? zonePlace(f.start.zone);
  const to = flightCities(f).to ?? zonePlace(f.end.zone);
  const leaves = `You leave ${from} ${dayLabel(departs)} at ${formatClockExact(toLocal(f.start))}`;
  const arrives = `${dayLabel(lands)} at ${clockAt(f.end, f.endIsEstimated)}`;
  if (days >= 1) {
    const lost = Array.from({ length: days }, (_, i) => DateTime.fromISO(departs).plus({ days: i }).toISODate()).filter((n) => !inStretch.has(n));
    if (!lost.length) return null;
    const names = lost.map(dayLabel);
    if (days === 1) {
      return {
        hint: {
          text: `Not ${names[0]}: you're on the plane.`,
          why: `${leaves} and land in ${to} ${arrives} ${to} time${homeBracket(f.end, homeZone)}. The night of ${names[0]} is spent on the plane.`,
        },
        coming: null,
      };
    }
    const skipped = Array.from({ length: days - 1 }, (_, i) => dayLabel(DateTime.fromISO(departs).plus({ days: i + 1 }).toISODate()));
    return {
      hint: {
        text: `Not ${listOf(names)}: you're on the plane.`,
        why: `${leaves} and land in ${to} ${arrives} ${to} time. Crossing the date line skips ${listOf(skipped)}, so you spend the nights of ${names.slice(0, -1).join(", ")}${names.length > 1 ? " and " : ""}${names[names.length - 1]} on the plane.`,
      },
      coming: null,
    };
  }
  if (instantMs(f.end) - instantMs(f.start) < LONG_FLIGHT_MS) return null;
  const atHome = homeCities.has(to);
  if (days === 0 && atHome) return { hint: null, coming: `Coming home, you land in ${to} on ${arrives}, the same day you leave ${from}. No night on the plane.` };
  if (days === 0) {
    return {
      hint: {
        text: `Includes ${dayLabel(lands)}: you land the same day you leave.`,
        why: `${leaves} and land in ${to} ${dayLabel(lands)} at ${clockAt(f.end, f.endIsEstimated)}. You cross the date line, so you need a bed in ${to} that night.`,
      },
      coming: null,
    };
  }
  if (atHome) return null;
  return {
    hint: {
      text: `Includes ${dayLabel(lands)}: you land the day before you left.`,
      why: `${leaves} and land in ${to} ${dayLabel(lands)} at ${clockAt(f.end, f.endIsEstimated)} ${to} time. Crossing the date line puts you a day back, so you need a bed there from the night of ${dayLabel(lands)}.`,
    },
    coming: null,
  };
}

const MAX_HINTS = 2;

function nightNotes(flights: VisibleItem[], inStretch: Set<string>, homeZone: Zone): { hints: NightHint[]; moreHints: number; nightNotes: string[] } {
  const homeCities = new Set([zonePlace(homeZone), flightCities(flights[0]).from].filter((c): c is string => c !== null));
  const notes = flights.flatMap((f) => {
    const note = noteFor(f, inStretch, homeCities, homeZone);
    return note ? [note] : [];
  });
  const hints = notes.flatMap((n) => (n.hint ? [n.hint] : []));
  return {
    hints: hints.slice(0, MAX_HINTS),
    moreHints: Math.max(0, hints.length - MAX_HINTS),
    nightNotes: notes.flatMap((n) => [n.hint?.why ?? n.coming ?? ""].filter(Boolean)),
  };
}

export function sleepPlan(view: Pick<TripView, "items" | "homeZone">, opts: { from?: string } = {}): SleepPlan {
  const items = [...view.items].sort(byStart);
  const flights = items.filter((i) => i.type === "flight");
  if (!flights.length) return { stretches: [], planeNights: [], entries: [], summary: null };
  const legs = items.filter((i) => i.type === "flight" || i.type === "transfer");
  const statuses = nightStatuses(view);
  const landingDate = [localDateKey(flights[0].end), opts.from ?? ""].sort().at(-1) ?? "";

  const stretches: SleepStretch[] = [];
  for (const group of groupOpenNights(statuses, landingDate)) {
    stretches.push(buildStretch(group, legs, view.homeZone, statuses, stretches.at(-1)?.nights.at(-1) ?? ""));
  }
  const inStretch = new Set(stretches.flatMap((s) => s.nights));
  const planeNights = planeNightsOf(flights, statuses, inStretch, view.homeZone).filter((p) => p.night >= (opts.from ?? ""));

  const entries: SleepEntry[] = [
    ...stretches.map((s) => ({ kind: "stretch" as const, ...s })),
    ...planeNights.map((p) => ({ kind: "plane" as const, ...p })),
  ].sort((a, b) => (a.kind === "stretch" ? a.checkIn : a.night).localeCompare(b.kind === "stretch" ? b.checkIn : b.night));
  const cities = [...new Set(stretches.map((st) => st.city))];
  const nights = stretches.reduce((sum, st) => sum + st.nights.length, 0);
  const summary: SleepSummary | null = stretches.length
    ? {
        nights,
        checkIn: stretches[0].checkIn,
        checkOut: stretches[stretches.length - 1].checkOut,
        cities,
        heading: `${cities.length > 1 ? "You need places to stay" : "You need a place to stay"}: ${nights} ${nights === 1 ? "night" : "nights"}`,
        stretchLines: stretches.map((st) => ({
          city: st.city,
          checkIn: st.checkIn,
          checkOut: st.checkOut,
          line: `${cities.length > 1 ? `${st.city}: ` : ""}Check in ${dayLabel(st.checkIn)} · Check out ${dayLabel(st.checkOut)}`,
        })),
        ...nightNotes(flights, inStretch, view.homeZone),
      }
    : null;
  return { stretches, planeNights, entries, summary };
}
