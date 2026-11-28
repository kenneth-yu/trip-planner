import { DateTime } from "../time/luxon";
import { formatClockExact } from "../time/format";
import type { ZonedTime } from "../types";

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

export const MIN_FLIGHT_MS = 7 * HOUR;
export const MIN_ZONES_CROSSED = 5;
export const AFTER_FIRST_MEAL_MS = 2 * HOUR;
export const BEFORE_LANDING_MEAL_MS = 90 * MINUTE;
export const MIN_WINDOW_MS = 3 * HOUR;
export const DESTINATION_BEDTIME_HOUR = 20;
export const DESTINATION_WAKE_HOUR = 6;
export const LANDING_DAY_FROM_HOUR = 4;
export const LANDING_DAY_UNTIL_HOUR = 16;
export const STAY_UP_UNTIL = "9:00pm";

export const MEAL_NOTE = "Meals are usually served about 1 to 2 hours after takeoff and about 1½ to 2 hours before landing.";
export const NOT_MEDICAL = "General guidance, not medical advice.";

export interface SleepFlight {
  id: string;
  updatedAt: string;
  start: ZonedTime;
  end: ZonedTime;
}

export interface SleepWindow {
  key: string;
  itemId: string;
  from: ZonedTime;
  until: ZonedTime;
  minutes: number;
  endsBeforeMeal: boolean;
  line: string;
  landingHint: string;
  why: string[];
}

function zoneName(zone: string): string {
  const last = zone.split("/").pop() ?? zone;
  return last.replace(/_/g, " ");
}

function at(ms: number, zone: string): DateTime {
  return DateTime.fromMillis(ms, { zone });
}

function clockIn(ms: number, zone: string): string {
  return formatClockExact(at(ms, zone));
}

function both(ms: number, zone: string, home: string): string {
  const there = `${clockIn(ms, zone)} ${zoneName(zone)} time`;
  if (zone === home) return there;
  return `${there} (${clockIn(ms, home)} ${zoneName(home)})`;
}

function zonesCrossed(flight: SleepFlight): number {
  const depart = at(Date.parse(flight.start.at), flight.start.zone).offset;
  const arrive = at(Date.parse(flight.end.at), flight.end.zone).offset;
  return Math.abs(arrive - depart) / 60;
}

function latestAtHourBefore(ms: number, zone: string, hour: number): number {
  const local = at(ms, zone);
  const today = local.set({ hour, minute: 0, second: 0, millisecond: 0 });
  return (today.toMillis() <= ms ? today : today.minus({ days: 1 })).toMillis();
}

function firstAtHourAfter(ms: number, zone: string, hour: number): number {
  const local = at(ms, zone);
  const today = local.set({ hour, minute: 0, second: 0, millisecond: 0 });
  return (today.toMillis() > ms ? today : today.plus({ days: 1 })).toMillis();
}

function roundedHalfHours(ms: number): string {
  const halves = Math.round(ms / (30 * MINUTE));
  const whole = Math.floor(halves / 2);
  const half = halves % 2 === 1;
  const unit = whole === 1 && !half ? "hour" : "hours";
  return `${whole}${half ? "½" : ""} ${unit}`;
}

function landingSentences(arrivalMs: number, zone: string): { hint: string; why: string } {
  const local = at(arrivalMs, zone);
  const clock = formatClockExact(local);
  const daytime = local.hour >= LANDING_DAY_FROM_HOUR && local.hour < LANDING_DAY_UNTIL_HOUR;
  if (daytime) {
    return {
      hint: `On landing at ${clock}, stay up until about ${STAY_UP_UNTIL}.`,
      why: `On landing at ${clock}, get daylight and stay up until about ${STAY_UP_UNTIL}.`,
    };
  }
  const bedtime = `On landing at ${clock}, go to bed at local bedtime.`;
  return { hint: bedtime, why: bedtime };
}

export function sleepWindow(flight: SleepFlight, homeZone: string): SleepWindow | null {
  const departMs = Date.parse(flight.start.at);
  const arriveMs = Date.parse(flight.end.at);
  const zone = flight.end.zone;
  if (!(arriveMs - departMs >= MIN_FLIGHT_MS)) return null;
  if (!(zonesCrossed(flight) >= MIN_ZONES_CROSSED)) return null;

  const evening = latestAtHourBefore(arriveMs, zone, DESTINATION_BEDTIME_HOUR);
  const from = Math.max(departMs + AFTER_FIRST_MEAL_MS, evening);
  const startHour = at(from, zone).hour;
  if (startHour >= DESTINATION_WAKE_HOUR && startHour < DESTINATION_BEDTIME_HOUR) return null;
  const morning = firstAtHourAfter(from, zone, DESTINATION_WAKE_HOUR);
  const beforeMeal = arriveMs - BEFORE_LANDING_MEAL_MS;
  const until = Math.min(beforeMeal, morning);
  const length = until - from;
  if (!(length >= MIN_WINDOW_MS)) return null;

  const endsBeforeMeal = beforeMeal <= morning;
  const place = zoneName(zone);
  const landing = landingSentences(arriveMs, zone);
  const sleepUntil = `then sleep until about ${both(until, zone, homeZone)}${endsBeforeMeal ? ", before the meal served before landing" : ""}.`;
  return {
    key: ["sleep", `${flight.id}@${flight.updatedAt}`, homeZone].join("|"),
    itemId: flight.id,
    from: { at: new Date(from).toISOString(), zone },
    until: { at: new Date(until).toISOString(), zone },
    minutes: Math.round(length / MINUTE),
    endsBeforeMeal,
    line: `Sleep tip: from ${both(from, zone, homeZone)}, about ${roundedHalfHours(length)}.`,
    landingHint: landing.hint,
    why: [
      `To shift toward ${place} time, stay awake until about ${both(from, zone, homeZone)}, ${sleepUntil}`,
      MEAL_NOTE,
      landing.why,
      NOT_MEDICAL,
    ],
  };
}
