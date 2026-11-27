import { DateTime } from "./luxon";
import type { Zone } from "../types";

export type LocalTimeProblem = "repeats" | "skipped";

const SHIFTS_MS = [60 * 60 * 1000, 30 * 60 * 1000];
const LOCAL_SHAPE = "yyyy-MM-dd'T'HH:mm";

export function localTimeProblem(local: string, zone: Zone): LocalTimeProblem | null {
  const wanted = DateTime.fromISO(local, { zone: "utc" }).toFormat(LOCAL_SHAPE);
  const ms = DateTime.fromISO(local, { zone }).toMillis();
  if (DateTime.fromMillis(ms, { zone }).toFormat(LOCAL_SHAPE) !== wanted) return "skipped";
  const twin = SHIFTS_MS.some((shift) => [ms - shift, ms + shift].some((other) => DateTime.fromMillis(other, { zone }).toFormat(LOCAL_SHAPE) === wanted));
  return twin ? "repeats" : null;
}

export function localTimeFlag(problem: LocalTimeProblem, local: string, label: string): string {
  const clock = local.slice(11);
  return problem === "repeats"
    ? `${label} ${clock} happens twice that day because the clocks go back. Check which one your booking means.`
    : `${label} ${clock} does not exist that day because the clocks skip ahead. Check the time on your booking.`;
}
