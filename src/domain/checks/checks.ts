import { DateTime } from "../time/luxon";
import type { TripView, VisibleItem } from "../visibility/project";
import { itemCity, whereAt } from "../time/days";
import { flightCities } from "../time/flight-card";
import { formatClock, formatShortDate, instantMs, localDateKey, toLocal } from "../time/format";
import { airportByCode, airportShortName } from "../time/places";

export type CheckKind =
  | "overlapping_stays"
  | "nowhere_to_sleep"
  | "airport_switch"
  | "city_change_no_transport"
  | "records_disagree"
  | "late_arrival"
  | "plan_outside_places"
  | "tight_connection"
  | "busy_overlap"
  | "unsure_place";

export interface Finding {
  key: string;
  kind: CheckKind;
  sentence: string;
  itemIds: string[];
}

const HOUR = 3600_000;
export const FLIGHT_EXIT_MS = 90 * 60_000;
export const TIGHT_INTERNATIONAL_MS = 2 * HOUR;
export const TIGHT_DOMESTIC_MS = 1 * HOUR;

export function findingKey(kind: CheckKind, items: Pick<VisibleItem, "id" | "updatedAt">[], extra = ""): string {
  return [kind, ...items.map((i) => `${i.id}@${i.updatedAt}`).sort(), extra].join("|");
}

const byStart = (a: VisibleItem, b: VisibleItem) => instantMs(a.start) - instantMs(b.start);
const of = (view: TripView, type: VisibleItem["type"]) => view.items.filter((i) => i.type === type).sort(byStart);
const label = (i: VisibleItem) => i.stay?.propertyName ?? i.title;
const shareTraveler = (a: VisibleItem, b: VisibleItem) =>
  !a.travelerIds.length || !b.travelerIds.length || a.travelerIds.some((t) => b.travelerIds.includes(t));
const airportName = (code: string) => {
  const a = airportByCode(code);
  return a ? airportShortName(a) : code;
};
const dayOf = (t: VisibleItem["start"]) => formatShortDate(toLocal(t));
const lowerFirst = (s: string) => (/^[A-Z][a-z]/.test(s) ? s[0].toLowerCase() + s.slice(1) : s);

function nights(stay: VisibleItem): string[] {
  const out: string[] = [];
  let d = DateTime.fromISO(localDateKey(stay.start));
  const end = localDateKey(stay.end);
  while (d.toISODate() < end) {
    out.push(d.toISODate());
    d = d.plus({ days: 1 });
  }
  return out;
}

export function overlappingStays(view: TripView): Finding[] {
  const stays = of(view, "stay");
  const out: Finding[] = [];
  for (let i = 0; i < stays.length; i++) {
    for (let j = i + 1; j < stays.length; j++) {
      const [a, b] = [stays[i], stays[j]];
      if (!shareTraveler(a, b)) continue;
      const shared = nights(a).filter((n) => nights(b).includes(n));
      if (!shared.length) continue;
      const from = formatShortDate(DateTime.fromISO(shared[0]));
      const to = DateTime.fromISO(shared[shared.length - 1]).plus({ days: 1 }).day;
      out.push({
        key: findingKey("overlapping_stays", [a, b]),
        kind: "overlapping_stays",
        sentence: `Two stays overlap ${from} to ${to}: ${label(a)} and '${label(b)}'. Check whether one is a duplicate.`,
        itemIds: [a.id, b.id],
      });
    }
  }
  return out;
}

export function nowhereToSleep(view: TripView): Finding[] {
  const flights = of(view, "flight");
  if (!flights.length) return [];
  const stays = of(view, "stay");
  const firstLanding = flights[0];
  const lastDeparture = flights[flights.length - 1];
  const out: Finding[] = [];
  let d = DateTime.fromISO(localDateKey(firstLanding.end));
  const stop = localDateKey(lastDeparture.start);
  while (d.toISODate() < stop) {
    const night = d.toISODate();
    const where = whereAt(DateTime.fromISO(`${night}T23:30`, { zone: firstLanding.end.zone }).toMillis(), view.items, view.homeZone);
    const zoneNight = DateTime.fromISO(`${night}T23:30`, { zone: where.zone }).toMillis();
    const covered = stays.some((s) => nights(s).includes(night));
    const flying = whereAt(zoneNight, view.items, view.homeZone).kind === "air";
    if (!covered && !flying) {
      out.push({
        key: findingKey("nowhere_to_sleep", stays, night),
        kind: "nowhere_to_sleep",
        sentence: `Nowhere booked for the night of ${formatShortDate(d)}${where.city ? ` in ${where.city}` : ""}.`,
        itemIds: [],
      });
    }
    d = d.plus({ days: 1 });
  }
  return out;
}

export function airportSwitch(view: TripView): Finding[] {
  const flights = of(view, "flight");
  const out: Finding[] = [];
  for (let i = 0; i + 1 < flights.length; i++) {
    const [land, next] = [flights[i], flights[i + 1]];
    if (!land.flight || !next.flight || land.flight.toAirport === next.flight.fromAirport) continue;
    if (flightCities(land).to !== flightCities(next).from) continue;
    out.push({
      key: findingKey("airport_switch", [land, next]),
      kind: "airport_switch",
      sentence: `You land at ${airportName(land.flight.toAirport)} on ${dayOf(land.end)} but fly out of ${airportName(next.flight.fromAirport)} on ${dayOf(next.start)}.`,
      itemIds: [land.id, next.id],
    });
  }
  return out;
}

export function cityChangeNoTransport(view: TripView): Finding[] {
  const stays = of(view, "stay").filter((s) => itemCity(s));
  const moves = view.items.filter((i) => i.type === "flight" || i.type === "transfer");
  const out: Finding[] = [];
  for (let i = 1; i < stays.length; i++) {
    const [prev, next] = [stays[i - 1], stays[i]];
    const [from, to] = [itemCity(prev), itemCity(next)];
    if (from === to) continue;
    const covered = moves.some((m) => instantMs(m.start) >= instantMs(prev.start) && instantMs(m.end) <= instantMs(next.end));
    if (covered) continue;
    out.push({
      key: findingKey("city_change_no_transport", [prev, next]),
      kind: "city_change_no_transport",
      sentence: `Nothing booked to get from ${from} to ${to} on ${dayOf(next.start)}.`,
      itemIds: [prev.id, next.id],
    });
  }
  return out;
}

export function lateArrival(view: TripView): Finding[] {
  const out: Finding[] = [];
  for (const stay of of(view, "stay")) {
    const cutoff = stay.stay?.lateArrivalCutoff;
    if (!cutoff) continue;
    const checkInDay = localDateKey(stay.start);
    const cutoffMs = DateTime.fromISO(`${checkInDay}T${cutoff}`, { zone: stay.start.zone }).toMillis();
    const before = view.items
      .filter((i) => (i.type === "flight" ? localDateKey(i.end) : localDateKey(i.start)) === checkInDay)
      .filter((i) => i.type === "flight" || i.type === "plan")
      .map((i) => ({ item: i, doneMs: instantMs(i.end) + (i.type === "flight" ? FLIGHT_EXIT_MS : 0) }))
      .sort((a, b) => b.doneMs - a.doneMs)[0];
    if (!before || before.doneMs < cutoffMs) continue;
    const what = before.item.type === "flight" ? `flight ${before.item.flight?.flightNumber} gets you out of the airport` : `${lowerFirst(before.item.title.split(",")[0])} ends`;
    const when = formatClock(DateTime.fromMillis(before.doneMs, { zone: stay.start.zone }));
    const cut = formatClock(DateTime.fromMillis(cutoffMs, { zone: stay.start.zone }));
    out.push({
      key: findingKey("late_arrival", [stay, before.item]),
      kind: "late_arrival",
      sentence: `Your ${what} at ${when} and ${label(stay)} asks to be told about arrivals after ${cut}. Check in first or let them know.`,
      itemIds: [stay.id, before.item.id],
    });
  }
  return out;
}

export function planOutsidePlaces(view: TripView): Finding[] {
  const out: Finding[] = [];
  for (const plan of of(view, "plan")) {
    const city = itemCity(plan);
    if (!city || plan.flags.length > 0) continue;
    const where = whereAt(instantMs(plan.start), view.items.filter((i) => i.id !== plan.id), view.homeZone);
    if (where.kind === "air" || !where.city || where.city === city) continue;
    const t = DateTime.fromMillis(instantMs(plan.start), { zone: where.zone });
    out.push({
      key: findingKey("plan_outside_places", [plan]),
      kind: "plan_outside_places",
      sentence: `${plan.title.split(",")[0]} is in ${city}, but you are in ${where.city} at ${formatClock(t)} on ${formatShortDate(t)}.`,
      itemIds: [plan.id],
    });
  }
  return out;
}

export function tightConnection(view: TripView): Finding[] {
  const out: Finding[] = [];
  const timed = view.items.filter((i) => i.type !== "stay").sort(byStart);
  for (const flight of of(view, "flight")) {
    const landMs = instantMs(flight.end);
    const next = timed.find((i) => i.id !== flight.id && instantMs(i.start) >= landMs);
    if (!next) continue;
    const from = airportByCode(flight.flight?.fromAirport ?? "");
    const to = airportByCode(flight.flight?.toAirport ?? "");
    const buffer = from && to && from.country === to.country ? TIGHT_DOMESTIC_MS : TIGHT_INTERNATIONAL_MS;
    if (instantMs(next.start) - landMs >= buffer) continue;
    out.push({
      key: findingKey("tight_connection", [flight, next]),
      kind: "tight_connection",
      sentence: `You land at ${formatClock(toLocal(flight.end))} and your next plan is at ${formatClock(toLocal(next.start))}. That may be tight${buffer === TIGHT_INTERNATIONAL_MS ? " after immigration" : ""}.`,
      itemIds: [flight.id, next.id],
    });
  }
  return out;
}

export function busyOverlap(view: TripView): Finding[] {
  const out: Finding[] = [];
  for (const b of view.busy) {
    const clash = view.items.find(
      (i) => i.type !== "stay" && instantMs(i.start) < instantMs(b.end) && instantMs(b.start) < instantMs(i.end),
    );
    if (!clash) continue;
    out.push({
      key: findingKey("busy_overlap", [clash], b.start.at),
      kind: "busy_overlap",
      sentence: `You have something else at ${formatClock(toLocal(b.start))}.`,
      itemIds: [clash.id],
    });
  }
  return out;
}

export function unsurePlace(view: TripView): Finding[] {
  return view.items
    .filter((i) => i.flags.length > 0)
    .map((i) => ({
      key: findingKey("unsure_place", [i]),
      kind: "unsure_place" as const,
      sentence: `${i.title.split(",")[0]}: ${i.flags.join(" ")}`,
      itemIds: [i.id],
    }));
}

export const CHECKS: ((view: TripView) => Finding[])[] = [
  overlappingStays,
  nowhereToSleep,
  airportSwitch,
  cityChangeNoTransport,
  lateArrival,
  planOutsidePlaces,
  tightConnection,
  busyOverlap,
  unsurePlace,
];

const PRIORITY: CheckKind[] = [
  "records_disagree",
  "unsure_place",
  "overlapping_stays",
  "city_change_no_transport",
  "nowhere_to_sleep",
  "late_arrival",
  "tight_connection",
  "plan_outside_places",
  "airport_switch",
  "busy_overlap",
];

export function byImportance<T extends Pick<Finding, "kind">>(findings: T[]): T[] {
  return [...findings].sort((a, b) => PRIORITY.indexOf(a.kind) - PRIORITY.indexOf(b.kind));
}

export function runChecks(view: TripView, opts: { dismissedKeys?: Set<string>; extra?: Finding[] } = {}): Finding[] {
  if (!view.permissions.canSeeDeadlines) return [];
  const all = [...CHECKS.flatMap((c) => c(view)), ...(opts.extra ?? [])];
  return all.filter((f) => !opts.dismissedKeys?.has(f.key));
}
