import { DateTime, Info } from "./luxon";
import type { Zone, ZonedTime } from "../types";

export function toLocal(t: ZonedTime): DateTime {
  return DateTime.fromISO(t.at, { zone: "utc" }).setZone(t.zone);
}

export function instantMs(t: ZonedTime | string): number {
  return DateTime.fromISO(typeof t === "string" ? t : t.at, { zone: "utc" }).toMillis();
}

export function fromLocal(local: string, zone: Zone): ZonedTime {
  if (!Info.isValidIANAZone(zone)) throw new Error(`Unknown time zone "${zone}"`);
  return { at: DateTime.fromISO(local, { zone }).toUTC().toISO(), zone };
}

export function isValidZone(zone: string): boolean {
  return Info.isValidIANAZone(zone);
}

export function formatClock(dt: DateTime): string {
  if (dt.hour === 12 && dt.minute === 0) return "noon";
  if (dt.hour === 0 && dt.minute === 0) return "midnight";
  const h = dt.hour % 12 === 0 ? 12 : dt.hour % 12;
  const suffix = dt.hour < 12 ? "am" : "pm";
  return `${h}:${String(dt.minute).padStart(2, "0")}${suffix}`;
}

export function formatClockExact(dt: DateTime): string {
  const h = dt.hour % 12 === 0 ? 12 : dt.hour % 12;
  return `${h}:${String(dt.minute).padStart(2, "0")}${dt.hour < 12 ? "am" : "pm"}`;
}

export function formatWeekday(dt: DateTime): string {
  return dt.toFormat("ccc", { locale: "en-US" });
}

export function formatDayHeader(dt: DateTime): string {
  return dt.toFormat("ccc LLL d", { locale: "en-US" });
}

export function formatShortDate(dt: DateTime): string {
  return dt.toFormat("LLL d", { locale: "en-US" });
}

export function formatFlightDuration(start: ZonedTime, end: ZonedTime): string {
  const minutes = Math.round((instantMs(end) - instantMs(start)) / 60000);
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

export function formatTimeUntil(fromMs: number, toMs: number): string {
  const minutes = Math.round((toMs - fromMs) / 60000);
  if (minutes < 0) return "passed";
  if (minutes < 60) return `in about ${Math.max(5, Math.round(minutes / 5) * 5)} min`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return hours === 1 ? "in 1 hour" : `in ${hours} hours`;
  const days = Math.round(hours / 24);
  return days === 1 ? "in 1 day" : `in ${days} days`;
}

export function localDateKey(t: ZonedTime): string {
  return toLocal(t).toISODate();
}

export function offsetAt(zone: Zone, atIso: string): number {
  return DateTime.fromISO(atIso, { zone: "utc" }).setZone(zone).offset;
}

const HOME_LABELS: Record<string, string> = {
  "America/New_York": "NY",
  "America/Los_Angeles": "LA",
};

export function zoneLabel(zone: Zone): string {
  if (HOME_LABELS[zone]) return HOME_LABELS[zone];
  const last = zone.split("/").pop() ?? zone;
  return last.replace(/_/g, " ");
}

export function homeReference(t: ZonedTime, homeZone: Zone | null, label?: string): string | null {
  if (!homeZone) return null;
  if (offsetAt(homeZone, t.at) === offsetAt(t.zone, t.at)) return null;
  const local = toLocal(t);
  const home = local.setZone(homeZone);
  const day = home.toISODate() !== local.toISODate() ? ` ${formatWeekday(home)}` : "";
  return `${formatClock(home)}${day} ${label ?? zoneLabel(homeZone)}`;
}
