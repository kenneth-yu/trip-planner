import type { VisibleItem } from "../visibility/project";
import { airportByCode } from "../time/places";

const HOUR = 3600_000;
const MINUTE = 60_000;

export const INTERNATIONAL_EXIT_MS = 90 * MINUTE;
export const DOMESTIC_EXIT_MS = 45 * MINUTE;
export const INTERNATIONAL_LEAD_MS = 3 * HOUR;
export const DOMESTIC_LEAD_MS = 2 * HOUR;
export const USUAL_CHECK_IN = { hour: 15, label: "3:00pm" };
export const USUAL_CHECK_OUT = { hour: 11, label: "11:00am" };

export function isDomesticFlight(item: Pick<VisibleItem, "flight">): boolean {
  const from = airportByCode(item.flight?.fromAirport ?? "");
  const to = airportByCode(item.flight?.toAirport ?? "");
  return Boolean(from && to && from.country === to.country);
}

export function exitMs(flight: Pick<VisibleItem, "flight">): number {
  return isDomesticFlight(flight) ? DOMESTIC_EXIT_MS : INTERNATIONAL_EXIT_MS;
}

export function leadMs(flight: Pick<VisibleItem, "flight">): number {
  return isDomesticFlight(flight) ? DOMESTIC_LEAD_MS : INTERNATIONAL_LEAD_MS;
}

export function minutesMs(minutes: number): number {
  return minutes * MINUTE;
}
