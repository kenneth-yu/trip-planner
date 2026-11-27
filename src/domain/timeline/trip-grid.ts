import { DateTime } from "../time/luxon";
import type { TripView, VisibleItem } from "../visibility/project";
import { buildDays, itemCity, whereAt } from "../time/days";
import { flightCities } from "../time/flight-card";
import { formatClock, formatTimeUntil, instantMs, localDateKey, offsetAt, toLocal } from "../time/format";

export interface GridDay {
  key: string;
  weekday: string;
  day: string;
  month: string | null;
  place: string | null;
  today: boolean;
}

export interface SleepSpan {
  key: string;
  from: number;
  to: number;
  city: string;
  cityIndex: number;
  nights: number;
  stays: string[];
}

export interface TravelEntry {
  key: string;
  itemId: string | null;
  kind: "departs" | "lands" | "transfer" | "missing";
  title: string;
  time: string | null;
}

export interface PlanEntry {
  key: string;
  itemId: string | null;
  title: string;
  time: string;
}

export interface UnsureSpan {
  key: string;
  itemId: string;
  from: number;
  to: number;
  title: string;
}

export interface TripGrid {
  days: GridDay[];
  sleep: SleepSpan[];
  travel: TravelEntry[][];
  plans: PlanEntry[][];
  unsure: UnsureSpan[];
  cities: string[];
  route: string[];
}

const byStart = (a: VisibleItem, b: VisibleItem) => instantMs(a.start) - instantMs(b.start);
const isConfirmed = (i: VisibleItem) => i.status === "confirmed";

export function stayCities(view: TripView): string[] {
  const out: string[] = [];
  for (const item of [...view.items].sort(byStart)) {
    if (item.type !== "stay" || !isConfirmed(item)) continue;
    const city = itemCity(item);
    if (city && !out.includes(city)) out.push(city);
  }
  return out;
}

function nightKeys(stay: VisibleItem): string[] {
  const out: string[] = [];
  let d = DateTime.fromISO(localDateKey(stay.start));
  const end = localDateKey(stay.end);
  while (d.toISODate() < end) {
    out.push(d.toISODate());
    d = d.plus({ days: 1 });
  }
  return out;
}

function sleepSpans(stays: VisibleItem[], keys: string[], cities: string[]): SleepSpan[] {
  const byNight = keys.map((key) => stays.find((s) => itemCity(s) && nightKeys(s).includes(key)) ?? null);
  const spans: SleepSpan[] = [];
  byNight.forEach((stay, i) => {
    if (!stay) return;
    const city = itemCity(stay);
    if (!city) return;
    const name = stay.stay?.propertyName ?? stay.title;
    const last = spans.at(-1);
    if (last && last.to === i && last.city === city) {
      last.to = i + 1;
      last.nights += 1;
      if (!last.stays.includes(name)) last.stays.push(name);
      return;
    }
    spans.push({ key: `sleep:${keys[i]}`, from: i, to: i + 1, city, cityIndex: cities.indexOf(city), nights: 1, stays: [name] });
  });
  return spans;
}

function cityAfter(item: VisibleItem): string | null {
  if (item.type === "flight") return flightCities(item).to;
  if (item.type === "transfer") return item.transfer?.toPlace?.city ?? itemCity(item);
  return itemCity(item);
}

function cityBefore(item: VisibleItem): string | null {
  if (item.type === "flight") return flightCities(item).from;
  if (item.type === "transfer") return item.transfer?.fromPlace?.city ?? itemCity(item);
  return itemCity(item);
}

export function missingTransfers(items: VisibleItem[]): { dayKey: string; from: string; to: string }[] {
  const anchors = items.filter((i) => isConfirmed(i) && (i.type === "stay" || i.type === "flight" || i.type === "transfer")).sort(byStart);
  const out: { dayKey: string; from: string; to: string }[] = [];
  let current: { city: string; since: VisibleItem } | null = null;
  for (const item of anchors) {
    const startsIn = cityBefore(item);
    if (current && startsIn && startsIn !== current.city) {
      out.push({ dayKey: localDateKey(current.since.end), from: current.city, to: startsIn });
    }
    const endsIn = cityAfter(item);
    if (endsIn) current = { city: endsIn, since: item };
  }
  return out;
}

function clockChange(item: VisibleItem): string | null {
  const minutes = offsetAt(item.end.zone, item.end.at) - offsetAt(item.start.zone, item.start.at);
  if (minutes === 0) return null;
  const hours = Math.abs(minutes) / 60;
  const n = Number.isInteger(hours) ? String(hours) : hours.toFixed(1);
  return `clocks ${minutes > 0 ? "+" : "-"}${n}h`;
}

function travelOn(key: string, items: VisibleItem[], gaps: { dayKey: string; to: string }[]): TravelEntry[] {
  const out: TravelEntry[] = [];
  for (const i of items) {
    if (i.type === "flight") {
      const to = flightCities(i).to ?? i.flight?.toAirport ?? "";
      if (localDateKey(i.start) === key) {
        out.push({ key: `dep:${i.id}`, itemId: i.id, kind: "departs", title: `${i.flight?.flightNumber ?? i.title} to ${to}`, time: `leaves ${formatClock(toLocal(i.start))}` });
      }
      if (localDateKey(i.end) === key) {
        const clocks = clockChange(i);
        out.push({ key: `arr:${i.id}`, itemId: i.id, kind: "lands", title: `Land in ${to}`, time: [formatClock(toLocal(i.end)), clocks].filter(Boolean).join(", ") });
      }
    }
    if (i.type === "transfer" && isConfirmed(i) && localDateKey(i.start) === key) {
      out.push({ key: `tr:${i.id}`, itemId: i.id, kind: "transfer", title: i.title, time: formatClock(toLocal(i.start)) });
    }
  }
  for (const g of gaps.filter((g) => g.dayKey === key)) {
    out.push({ key: `gap:${key}:${g.to}`, itemId: null, kind: "missing", title: `No way to ${g.to} booked`, time: null });
  }
  return out;
}

function plansOn(key: string, view: TripView): PlanEntry[] {
  const plans = view.items
    .filter((i) => i.type === "plan" && isConfirmed(i) && localDateKey(i.start) === key)
    .map((i) => ({ at: instantMs(i.start), entry: { key: `plan:${i.id}`, itemId: i.id, title: i.title.split(",")[0], time: formatClock(toLocal(i.start)) } }));
  const busy = view.busy
    .filter((b) => localDateKey(b.start) === key)
    .map((b) => ({ at: instantMs(b.start), entry: { key: b.key, itemId: null, title: "Busy", time: formatClock(toLocal(b.start)) } }));
  return [...plans, ...busy].sort((a, b) => a.at - b.at).map((p) => p.entry);
}

export function routeOf(view: TripView): string[] {
  const stops: string[] = [];
  const add = (city: string | null) => {
    if (city && stops[stops.length - 1] !== city) stops.push(city);
  };
  for (const item of [...view.items].filter(isConfirmed).sort(byStart)) {
    if (item.type === "flight" || item.type === "transfer") {
      add(cityBefore(item));
      add(item.type === "flight" ? flightCities(item).to : (item.transfer?.toPlace?.city ?? itemCity(item)));
    } else if (item.type === "stay") {
      add(itemCity(item));
    }
  }
  return stops;
}

export function buildTripGrid(view: TripView, nowMs: number): TripGrid | null {
  const days = buildDays(view);
  if (!days.length) return null;
  const keys = days.map((d) => d.key);
  const items = [...view.items].sort(byStart);
  const cities = stayCities(view);
  const confirmedStays = items.filter((i) => i.type === "stay" && isConfirmed(i));
  const sleep = sleepSpans(confirmedStays, keys, cities);
  const gaps = missingTransfers(items);
  const todayKey = DateTime.fromMillis(nowMs, { zone: whereAt(nowMs, items, view.homeZone).zone }).toISODate();

  const unsure: UnsureSpan[] = items
    .filter((i) => i.type === "stay" && !isConfirmed(i))
    .flatMap((i) => {
      const nights = nightKeys(i).map((k) => keys.indexOf(k)).filter((n) => n >= 0);
      if (!nights.length) return [];
      return [{ key: `unsure:${i.id}`, itemId: i.id, from: nights[0], to: nights[nights.length - 1] + 1, title: i.title }];
    });

  return {
    days: days.map((d, i) => {
      const dt = DateTime.fromISO(d.key);
      const previous = i > 0 ? DateTime.fromISO(keys[i - 1]) : null;
      return {
        key: d.key,
        weekday: dt.toFormat("ccc", { locale: "en-US" }),
        day: String(dt.day),
        month: !previous || previous.month !== dt.month ? dt.toFormat("LLL", { locale: "en-US" }) : null,
        place: d.place,
        today: d.key === todayKey,
      };
    }),
    sleep,
    travel: keys.map((k) => travelOn(k, items, gaps)),
    plans: keys.map((k) => plansOn(k, view)),
    unsure,
    cities,
    route: routeOf(view),
  };
}

export function pickDay(days: Pick<GridDay, "key" | "today">[], requested: string | null): string | null {
  if (requested && days.some((d) => d.key === requested)) return requested;
  return days.find((d) => d.today)?.key ?? days[0]?.key ?? null;
}

export function tripSpan(view: TripView, nowMs: number): { dates: string; countdown: string | null } | null {
  const items = [...view.items].sort(byStart);
  if (!items.length) return null;
  const first = toLocal(items[0].start);
  const lastItem = items.reduce((a, b) => (instantMs(b.end) > instantMs(a.end) ? b : a));
  const last = toLocal(lastItem.end);
  const dates = first.month === last.month ? `${first.toFormat("LLL d")} to ${last.day}` : `${first.toFormat("LLL d")} to ${last.toFormat("LLL d")}`;
  const startMs = instantMs(items[0].start);
  const endMs = instantMs(lastItem.end);
  if (nowMs < startMs) {
    const days = Math.ceil((startMs - nowMs) / 86400_000);
    return { dates, countdown: days === 1 ? "You leave tomorrow" : `You leave in ${days} days` };
  }
  if (nowMs <= endMs) {
    const where = whereAt(nowMs, items, view.homeZone);
    return { dates, countdown: where.kind === "air" ? "You're in the air" : where.city ? `You're in ${where.city}` : null };
  }
  return { dates, countdown: null };
}

export interface StripDay {
  key: string;
  weekday: string;
  day: string;
  month: string | null;
  cityIndex: number | null;
  city: string | null;
  busy: boolean;
  needsAttention: boolean;
  today: boolean;
}

export function dayStrip(grid: TripGrid): StripDay[] {
  return grid.days.map((d, i) => {
    const night = grid.sleep.find((s) => s.from <= i && i < s.to) ?? null;
    return {
      key: d.key,
      weekday: d.weekday,
      day: d.day,
      month: d.month,
      cityIndex: night ? night.cityIndex : null,
      city: night ? night.city : null,
      busy: grid.plans[i].length > 0 || grid.travel[i].some((t) => t.kind !== "missing"),
      needsAttention: grid.travel[i].some((t) => t.kind === "missing") || grid.unsure.some((u) => u.from <= i && i < u.to),
      today: d.today,
    };
  });
}

export interface UpNextEntry {
  key: string;
  itemId: string;
  dayKey: string;
  date: string;
  time: string;
  title: string;
  place: string | null;
  inHowLong: string;
}

export function upNext(view: TripView, nowMs: number, count = 3): UpNextEntry[] {
  const entries = view.items
    .filter((i) => isConfirmed(i) && instantMs(i.end) > nowMs)
    .flatMap((i) => {
      const at = (t: VisibleItem["start"]) => ({ dayKey: localDateKey(t), date: toLocal(t).toFormat("ccc LLL d", { locale: "en-US" }), time: formatClock(toLocal(t)), ms: instantMs(t) });
      if (i.type === "flight") {
        return [{ ...at(i.start), key: `up:${i.id}`, itemId: i.id, title: `${i.flight?.flightNumber ?? i.title} to ${flightCities(i).to ?? i.flight?.toAirport ?? ""}`, place: flightCities(i).from }];
      }
      if (i.type === "stay") {
        const name = i.stay?.propertyName ?? i.title;
        const out = [];
        if (instantMs(i.start) > nowMs) out.push({ ...at(i.start), key: `in:${i.id}`, itemId: i.id, title: `Check in: ${name}`, place: itemCity(i) });
        out.push({ ...at(i.end), key: `out:${i.id}`, itemId: i.id, title: `Check out: ${name}`, place: itemCity(i) });
        return out;
      }
      return [{ ...at(i.start), key: `up:${i.id}`, itemId: i.id, title: i.title.split(",")[0], place: itemCity(i) }];
    })
    .filter((e) => e.ms > nowMs)
    .sort((a, b) => a.ms - b.ms)
    .slice(0, count);
  return entries.map(({ ms, ...e }) => ({ ...e, inHowLong: formatTimeUntil(nowMs, ms) }));
}
