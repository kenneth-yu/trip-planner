import type { DeadlineKind, Zone } from "../types";
import type { TripView, VisibleItem } from "../visibility/project";
import { itemCity } from "../time/days";
import { formatClockExact, formatShortDate, formatTimeUntil, formatWeekday, instantMs, offsetAt, toLocal, zoneLabel } from "../time/format";

export const WARNING_WINDOW_MS = 3 * 24 * 60 * 60 * 1000;

export interface DeadlineLine {
  id: string;
  itemId: string;
  at: string;
  sentence: string;
  exact: string;
  warning: boolean;
  passed: boolean;
  needsConfirming: boolean;
}

const PHRASE: Record<DeadlineKind, string> = {
  free_cancellation: "becomes non refundable",
  partial_refund: "stops giving any refund",
  change: "can no longer be changed for free",
  other: "has a deadline",
};

export function deadlineExact(at: { at: string; zone: Zone }, placeName: string | null, homeZone: Zone | null): string {
  const local = toLocal(at);
  const here = `${formatWeekday(local)} ${formatShortDate(local)}, ${formatClockExact(local)} ${placeName ?? zoneLabel(at.zone)}`;
  if (!homeZone || offsetAt(homeZone, at.at) === offsetAt(at.zone, at.at)) return here;
  const home = local.setZone(homeZone);
  return `${here} (${formatClockExact(home)} ${formatWeekday(home)} ${zoneLabel(homeZone)})`;
}

function itemLabel(item: VisibleItem): string {
  return item.stay?.propertyName ?? item.title;
}

export function buildDeadlineLines(view: TripView, nowMs: number): DeadlineLine[] {
  if (!view.permissions.canSeeDeadlines) return [];
  return view.items
    .filter((item) => item.booked)
    .flatMap((item) =>
      item.deadlines.map((d) => {
        const atMs = instantMs(d.at);
        const passed = atMs <= nowMs;
        return {
          id: d.id,
          itemId: item.id,
          at: d.at.at,
          sentence: passed
            ? `${itemLabel(item)} ${PHRASE[d.kind].replace("becomes", "became").replace("stops", "stopped").replace("can no longer", "could no longer")}`
            : `${itemLabel(item)} ${PHRASE[d.kind]} ${formatTimeUntil(nowMs, atMs)}`,
          exact: deadlineExact(d.at, itemCity(item), view.homeZone),
          warning: !passed && atMs - nowMs <= WARNING_WINDOW_MS,
          passed,
          needsConfirming: d.source === "parsed" && !d.confirmed,
        };
      }),
    )
    .sort((a, b) => a.at.localeCompare(b.at));
}
