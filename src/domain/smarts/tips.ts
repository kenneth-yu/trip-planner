import { DateTime } from "../time/luxon";
import { itemCity } from "../time/days";
import { flightCities } from "../time/flight-card";
import { formatClock, instantMs, localDateKey, toLocal } from "../time/format";
import { exitMs, isDomesticFlight, leadMs, minutesMs } from "../timeline/travel-times";
import type { TripView, VisibleItem } from "../visibility/project";
import { TIP_KINDS, type TipKind } from "./kinds";
import { sleepWindow } from "./sleep-window";

export { TIP_KINDS, type TipKind };

export interface SmartTip {
  key: string;
  kind: TipKind;
  itemId: string;
  row: "flight" | "check_in" | "check_out";
  itemIds: string[];
  line: string;
  why: string;
}

const HOUR = 3600_000;
const GAP_HOURS = 2;

const sharesTraveler = (a: VisibleItem, b: VisibleItem) => !a.travelerIds.length || !b.travelerIds.length || a.travelerIds.some((t) => b.travelerIds.includes(t));
const sameCity = (a: string | null, b: string | null) => a !== null && b !== null && a.trim().toLowerCase() === b.trim().toLowerCase();
const stayName = (stay: VisibleItem) => stay.stay?.propertyName ?? stay.title;

function tipKey(kind: TipKind, row: SmartTip["row"], items: Pick<VisibleItem, "id" | "updatedAt">[]): string {
  return ["tip", kind, row, ...items.map((i) => `${i.id}@${i.updatedAt}`).sort()].join("|");
}

function flightLabel(flight: VisibleItem): string {
  return (flight.flight?.flightNumber ?? flight.title).replace(/^([A-Za-z]{2,3})(\d)/, "$1 $2");
}

function aboutTime(minutes: number): string {
  if (minutes < 60) return `about ${minutes} ${minutes === 1 ? "minute" : "minutes"}`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  const h = `${hours} ${hours === 1 ? "hour" : "hours"}`;
  return rest === 0 ? `about ${h}` : `about ${h} ${rest} ${rest === 1 ? "minute" : "minutes"}`;
}

function stayForDeparture(view: TripView, flight: VisibleItem): VisibleItem | null {
  const city = flightCities(flight).from;
  const day = localDateKey(flight.start);
  const before = DateTime.fromISO(day).minus({ days: 1 }).toISODate();
  const candidates = view.items.filter((i) => i.type === "stay" && sharesTraveler(i, flight) && sameCity(itemCity(i), city));
  const checkingOut = candidates.find((s) => localDateKey(s.end) === day);
  if (checkingOut) return checkingOut;
  return candidates.find((s) => localDateKey(s.start) <= before && day <= localDateKey(s.end)) ?? null;
}

export function leaveByTips(view: TripView): SmartTip[] {
  const out: SmartTip[] = [];
  for (const flight of view.items) {
    if (flight.type !== "flight" || !flight.flight) continue;
    const stay = stayForDeparture(view, flight);
    if (!stay) continue;
    const domestic = isDomesticFlight(flight);
    const lead = leadMs(flight);
    const stored = stay.stay?.timeToAirportMinutes;
    const minutes = typeof stored === "number" && stored > 0 ? stored : null;
    const there = DateTime.fromMillis(instantMs(flight.start) - lead, { zone: flight.start.zone });
    const leave = minutes !== null ? DateTime.fromMillis(instantMs(flight.start) - lead - minutesMs(minutes), { zone: flight.start.zone }) : null;
    const place = flightCities(flight).from ?? "the airport";
    const rule = `Airlines suggest arriving about ${domestic ? "2" : "3"} hours before ${domestic ? "a domestic" : "an international"} flight.`;
    const base = `${flightLabel(flight)} leaves ${place} at ${formatClock(toLocal(flight.start))}. ${rule}`;
    out.push({
      key: tipKey("airport", "flight", [flight, stay]),
      kind: "airport",
      itemId: flight.id,
      row: "flight",
      itemIds: [flight.id, stay.id],
      line: leave ? `Leave the hotel by ${formatClock(leave)}.` : `Be at the airport by ${formatClock(there)}.`,
      why: leave && minutes !== null
        ? `${base} ${stayName(stay)} to the airport takes ${aboutTime(minutes)} (your estimate).`
        : `${base} Add how long it takes to get there on the stay, and this will say when to leave.`,
    });
  }
  return out;
}

function checkInMs(stay: VisibleItem): number {
  return instantMs(stay.start);
}

function wholeHours(ms: number): number {
  return Math.floor(ms / HOUR);
}

function hoursWord(n: number): string {
  return `${n} ${n === 1 ? "hour" : "hours"}`;
}

export function bagTips(view: TripView): SmartTip[] {
  const out: SmartTip[] = [];
  const stays = view.items.filter((i) => i.type === "stay");
  const flights = view.items.filter((i) => i.type === "flight" && i.flight);
  for (const stay of stays) {
    const city = itemCity(stay);
    const arriving = flights
      .filter((f) => sharesTraveler(f, stay) && sameCity(flightCities(f).to, city) && localDateKey(f.end) === localDateKey(stay.start))
      .sort((a, b) => instantMs(b.end) - instantMs(a.end))[0];
    if (arriving) {
      const ready = instantMs(arriving.end) + exitMs(arriving);
      const wait = checkInMs(stay) - ready;
      if (wait >= GAP_HOURS * HOUR) {
        const readyLocal = DateTime.fromMillis(ready, { zone: stay.start.zone });
        const hours = wholeHours(wait);
        const checkIn = toLocal(stay.start);
        out.push({
          key: tipKey("bags", "check_in", [arriving, stay]),
          kind: "bags",
          itemId: stay.id,
          row: "check_in",
          itemIds: [arriving.id, stay.id],
          line: `About ${hoursWord(hours)} before check-in. Store your bags?`,
          why: `You land at ${formatClock(toLocal(arriving.end))} and should be at ${stayName(stay)} around ${formatClock(readyLocal)}. Check-in is ${stay.startIsEstimated ? "usually " : ""}from ${formatClock(checkIn)}. Most hotels hold bags at the front desk, or ask for an early check-in.`,
        });
      }
    }
    const departing = flights
      .filter((f) => sharesTraveler(f, stay) && sameCity(flightCities(f).from, city) && localDateKey(f.start) === localDateKey(stay.end))
      .sort((a, b) => instantMs(a.start) - instantMs(b.start))[0];
    if (departing) {
      const minutes = stay.stay?.timeToAirportMinutes;
      const toAirport = typeof minutes === "number" && minutes > 0 ? minutesMs(minutes) : 0;
      const leave = instantMs(departing.start) - leadMs(departing) - toAirport;
      const wait = leave - instantMs(stay.end);
      if (wait >= GAP_HOURS * HOUR) {
        const hours = wholeHours(wait);
        const leaveLocal = DateTime.fromMillis(leave, { zone: stay.end.zone });
        const checkOut = toLocal(stay.end);
        out.push({
          key: tipKey("bags", "check_out", [departing, stay]),
          kind: "bags",
          itemId: stay.id,
          row: "check_out",
          itemIds: [departing.id, stay.id],
          line: `${hoursWord(hours)} between check-out and leaving. Store your bags?`,
          why: `Check-out is ${stay.endIsEstimated ? "usually " : ""}${formatClock(checkOut)}, and you leave for the airport around ${formatClock(leaveLocal)}. Most hotels hold bags at the front desk after check-out, or ask about a late check-out.`,
        });
      }
    }
  }
  return out;
}

export function sleepTips(view: TripView): SmartTip[] {
  const out: SmartTip[] = [];
  for (const flight of view.items) {
    if (flight.type !== "flight" || !flight.flight) continue;
    const found = sleepWindow(flight, view.homeZone);
    if (!found) continue;
    out.push({ key: found.key, kind: "sleep", itemId: flight.id, row: "flight", itemIds: [flight.id], line: found.line, why: found.why.join("\n") });
  }
  return out;
}

export function smartTips(view: TripView): SmartTip[] {
  return [...leaveByTips(view), ...sleepTips(view), ...bagTips(view)];
}
