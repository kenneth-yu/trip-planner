import { DateTime } from "../time/luxon";
import { fromLocal, instantMs } from "../time/format";
import type { Zone } from "../types";

export interface Arrival {
  local: string;
  nextDay: boolean;
}

const DAY_MS = 24 * 60 * 60 * 1000;

export function arrivalAfter(departLocal: string, departZone: Zone, arriveClock: string, arriveZone: Zone): Arrival | null {
  const depart = instantMs(fromLocal(departLocal, departZone));
  const departDate = departLocal.slice(0, 10);
  const date = DateTime.fromISO(departDate, { zone: "utc" });
  for (const offset of [0, 1]) {
    const local = `${date.plus({ days: offset }).toISODate()}T${arriveClock}`;
    const span = instantMs(fromLocal(local, arriveZone)) - depart;
    if (span > 0 && span < DAY_MS) return { local, nextDay: local.slice(0, 10) > departDate };
  }
  return null;
}
