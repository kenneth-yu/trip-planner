import type { CalendarEvent, CalendarEventTime } from "./calendar-event";

export const MAX_RANGE_DAYS = 364;
export const MAX_EVENTS_IN_RANGE = 500;
const DAY_MS = 86_400_000;
const DAY = /^(\d{4})-(\d{2})-(\d{2})$/;

export interface DateRange {
  from: string | null;
  to: string | null;
}

export type RangeProblem = "bad_dates" | "from_after_to" | "range_too_long";

export type RangeResult = { ok: true; range: DateRange } | { ok: false; problem: RangeProblem };

function dayMs(day: string): number | null {
  const m = DAY.exec(day);
  if (!m) return null;
  const [year, month, date] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const ms = Date.UTC(year, month - 1, date);
  const back = new Date(ms);
  if (back.getUTCFullYear() !== year || back.getUTCMonth() !== month - 1 || back.getUTCDate() !== date) return null;
  return ms;
}

function textOrNull(value: unknown): string | null | undefined {
  if (value === null || value === undefined) return null;
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed;
}

export function parseRange(from: unknown, to: unknown): RangeResult {
  const a = textOrNull(from);
  const b = textOrNull(to);
  if (a === undefined || b === undefined) return { ok: false, problem: "bad_dates" };
  const start = a === null ? null : dayMs(a);
  const end = b === null ? null : dayMs(b);
  if (a !== null && start === null) return { ok: false, problem: "bad_dates" };
  if (b !== null && end === null) return { ok: false, problem: "bad_dates" };
  if (start !== null && end !== null) {
    if (end < start) return { ok: false, problem: "from_after_to" };
    if (end - start > MAX_RANGE_DAYS * DAY_MS) return { ok: false, problem: "range_too_long" };
  }
  return { ok: true, range: { from: a, to: b } };
}

function dayOf(t: CalendarEventTime): string | null {
  const text = t.date ?? t.dateTime;
  if (typeof text !== "string") return null;
  const day = text.slice(0, 10);
  return dayMs(day) === null ? null : day;
}

function previousDay(day: string): string {
  const ms = dayMs(day);
  return ms === null ? day : new Date(ms - DAY_MS).toISOString().slice(0, 10);
}

export function inRange(event: CalendarEvent, range: DateRange): boolean {
  const first = dayOf(event.start);
  if (first === null) return false;
  const endDay = dayOf(event.end) ?? first;
  const last = event.end.date !== undefined && endDay > first ? previousDay(endDay) : endDay;
  if (range.from !== null && last < range.from) return false;
  if (range.to !== null && first > range.to) return false;
  return true;
}

export function defaultRange(starts: string[], ends: string[]): DateRange {
  const first = starts.filter((d) => dayMs(d) !== null).sort()[0];
  const last = ends.filter((d) => dayMs(d) !== null).sort().at(-1);
  if (first === undefined || last === undefined) return { from: null, to: null };
  const from = previousDay(first);
  const lastMs = dayMs(last) ?? 0;
  const capped = Math.min(lastMs + DAY_MS, (dayMs(from) ?? 0) + (MAX_RANGE_DAYS - 1) * DAY_MS);
  return { from, to: new Date(capped).toISOString().slice(0, 10) };
}
