import { formatClock, instantMs, toLocal } from "../time/format";
import { airportByCode, airportShortName, type Airport } from "../time/places";
import type { TripView, VisibleItem } from "../visibility/project";
import { durationText } from "./labels";
import { smartKey, type SmartCheck } from "./types";

const MINUTE = 60_000;
const MIN_SAME_KIND_MINUTES = 60;
const MIN_MIXED_KIND_MINUTES = 90;
const SEPARATE_BOOKINGS_MINUTES = 180;
const AIRPORT_CHANGE_MINUTES = 240;
const WINDOW_MS = 24 * 60 * MINUTE;

const sharesTraveler = (a: VisibleItem, b: VisibleItem) => !a.travelerIds.length || !b.travelerIds.length || a.travelerIds.some((t) => b.travelerIds.includes(t));

function codesOf(item: VisibleItem): Set<string> {
  return new Set(item.private.flatMap((p) => (p.confirmationCode ? [p.confirmationCode.trim().toUpperCase()] : [])));
}

function separateBookings(first: VisibleItem, second: VisibleItem): boolean {
  const a = codesOf(first);
  const b = codesOf(second);
  if (a.size > 0 && b.size > 0) return ![...a].some((code) => b.has(code));
  const [x, y] = [first.flight?.airline?.trim().toLowerCase(), second.flight?.airline?.trim().toLowerCase()];
  return Boolean(x && y && x !== y);
}

function international(from: Airport | null, to: Airport | null): boolean {
  return !(from && to && from.country === to.country);
}

function name(airport: Airport | null, code: string): string {
  return airport ? airportShortName(airport) : code;
}

function clockWithDay(item: VisibleItem, which: "start" | "end", other: VisibleItem): string {
  const local = toLocal(item[which]);
  const otherLocal = toLocal(which === "end" ? other.start : other.end);
  return local.toISODate() === otherLocal.toISODate() ? formatClock(local) : `${formatClock(local)} ${local.toFormat("ccc")}`;
}

function check(first: VisibleItem, second: VisibleItem, line: string, why: string, extra: string): SmartCheck {
  return { key: smartKey("risky_connection", [first, second], extra), kind: "risky_connection", itemId: second.id, itemIds: [first.id, second.id], line, why };
}

function connection(view: TripView, first: VisibleItem, second: VisibleItem): SmartCheck | null {
  const [land, leave] = [first.flight, second.flight];
  if (!land || !leave) return null;
  const gapMinutes = (instantMs(second.start) - instantMs(first.end)) / MINUTE;
  if (gapMinutes < 0 || gapMinutes * MINUTE >= WINDOW_MS) return null;
  const arrives = airportByCode(land.toAirport);
  const departs = airportByCode(leave.fromAirport);
  const gap = durationText(gapMinutes);
  const separate = view.permissions.canSeeSensitive && separateBookings(first, second);
  const landed = clockWithDay(first, "end", second);
  const nextLeaves = clockWithDay(second, "start", first);
  const bookingsWhy = "These are separate bookings, so if the first is late the second airline is not obliged to wait or rebook you.";

  if (land.toAirport.toUpperCase() !== leave.fromAirport.toUpperCase()) {
    if (!arrives || !departs || arrives.city !== departs.city || gapMinutes >= AIRPORT_CHANGE_MINUTES) return null;
    return check(
      first,
      second,
      `Change airports: ${name(arrives, land.toAirport)} to ${name(departs, leave.fromAirport)} in ${gap}.`,
      `You land at ${name(arrives, land.toAirport)} at ${landed} and the next flight leaves from ${name(departs, leave.fromAirport)} at ${nextLeaves}. Changing airports means getting across the city, collecting bags where needed and checking in again, so plan generous time.${separate ? ` ${bookingsWhy}` : ""}`,
      "airports",
    );
  }

  const code = land.toAirport.toUpperCase();
  const firstInternational = international(airportByCode(land.fromAirport), arrives);
  const secondInternational = international(departs, airportByCode(leave.toAirport));
  const minimum = firstInternational === secondInternational ? MIN_SAME_KIND_MINUTES : MIN_MIXED_KIND_MINUTES;
  const times = `You land at ${arrives?.city ?? code} at ${landed} and the next flight leaves at ${nextLeaves}.`;
  if (gapMinutes < minimum) {
    return check(first, second, `Tight: ${gap} to change planes at ${code}.`, `${times} Most airports need about 60 to 90 minutes to connect.${separate ? ` ${bookingsWhy}` : ""}`, "tight");
  }
  if (separate && gapMinutes < SEPARATE_BOOKINGS_MINUTES) {
    return check(first, second, `Separate bookings, ${gap} apart.`, `${times} ${bookingsWhy}`, "separate");
  }
  return null;
}

export function riskyConnections(view: TripView): SmartCheck[] {
  const flights = view.items.filter((i) => i.type === "flight" && i.flight).sort((a, b) => instantMs(a.start) - instantMs(b.start));
  const out: SmartCheck[] = [];
  flights.forEach((first, index) => {
    const second = flights.slice(index + 1).find((later) => sharesTraveler(first, later));
    if (!second) return;
    const found = connection(view, first, second);
    if (found) out.push(found);
  });
  return out;
}
