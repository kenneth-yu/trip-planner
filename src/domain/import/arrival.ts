import { DateTime } from "../time/luxon";
import { fromLocal, instantMs } from "../time/format";
import type { Zone } from "../types";

export interface Arrival {
  local: string;
  dayOffset: -1 | 0 | 1;
}

const DAY_MS = 24 * 60 * 60 * 1000;
const OFFSETS = [-1, 0, 1] as const;

export function arrivalAfter(departLocal: string, departZone: Zone, arriveClock: string, arriveZone: Zone): Arrival | null {
  const depart = instantMs(fromLocal(departLocal, departZone));
  const date = DateTime.fromISO(departLocal.slice(0, 10), { zone: "utc" });
  for (const dayOffset of OFFSETS) {
    const local = `${date.plus({ days: dayOffset }).toISODate()}T${arriveClock}`;
    const span = instantMs(fromLocal(local, arriveZone)) - depart;
    if (span > 0 && span < DAY_MS) return { local, dayOffset };
  }
  return null;
}

export function sameDayClockRoll(date: string, startClock: string, endClock: string): { local: string; dayOffset: 0 | 1 } {
  if (endClock >= startClock) return { local: `${date}T${endClock}`, dayOffset: 0 };
  return { local: `${DateTime.fromISO(date, { zone: "utc" }).plus({ days: 1 }).toISODate()}T${endClock}`, dayOffset: 1 };
}

export function dayNote(dayOffset: number, verb: "Lands" | "Ends"): string | null {
  if (dayOffset > 0) return `${verb} the next day`;
  if (dayOffset < 0) return `${verb} the day before`;
  return null;
}
