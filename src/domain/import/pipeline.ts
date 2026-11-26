import { DateTime } from "../time/luxon";
import type { Item, Zone } from "../types";
import { whereAt } from "../time/days";
import type { VisibleItem } from "../visibility/project";
import { mapCalendarEvent, type CalendarEvent } from "./calendar-event";
import { consolidate, matchRecords, type Match } from "./matching";
import type { Difference, ProposedItem } from "./proposal";

export interface InboxEntryDraft {
  proposed: ProposedItem;
  raw: unknown[];
  match: (Match & { itemId: string }) | null;
  differences: Difference[];
  unparsed: string[];
}

export interface ImportContext {
  calendarTravelers: Record<string, string[]>;
  defaultTravelerIds: string[];
  homeZone: Zone;
}

export function zoneOnDateFrom(items: VisibleItem[], homeZone: Zone) {
  const confirmed = items.filter((i) => i.status === "confirmed");
  return (isoDate: string): Zone | null => {
    if (!confirmed.length) return null;
    let zone = homeZone;
    for (let i = 0; i < 2; i++) zone = whereAt(DateTime.fromISO(`${isoDate}T12:00`, { zone }).toMillis(), confirmed, homeZone).zone;
    return zone === homeZone ? null : zone;
  };
}

export function matchAgainst(proposed: ProposedItem, items: (VisibleItem | Item)[]): (Match & { itemId: string }) | null {
  let best: (Match & { itemId: string }) | null = null;
  for (const item of items) {
    const m = matchRecords(item, proposed);
    if (!m) continue;
    if (!best || (m.strength === "strong" && best.strength === "possible")) best = { ...m, itemId: item.id };
  }
  return best;
}

export function planCalendarImport(events: CalendarEvent[], existing: VisibleItem[], ctx: ImportContext): InboxEntryDraft[] {
  const zoneOnDate = zoneOnDateFrom(existing, ctx.homeZone);
  const mapped = events.map((ev) =>
    mapCalendarEvent(ev, {
      travelerIds: (ev.calendar && ctx.calendarTravelers[ev.calendar]) || ctx.defaultTravelerIds,
      zoneOnDate,
      homeZone: ctx.homeZone,
    }),
  );
  return planProposals(
    mapped.map((m) => m.proposed),
    existing,
    events,
    mapped.map((m) => m.unparsed),
  );
}

export function planProposals(proposals: ProposedItem[], existing: (VisibleItem | Item)[], raw: unknown[] = proposals, unparsed: string[][] = []): InboxEntryDraft[] {
  return consolidate(proposals).map((cluster) => {
    const match = matchAgainst(cluster.proposed, existing);
    return {
      proposed: cluster.proposed,
      raw: cluster.sources.map((i) => raw[i]),
      match,
      differences: cluster.differences,
      unparsed: [...new Set(cluster.sources.flatMap((i) => unparsed[i] ?? []))],
    };
  });
}

export function isClean(entry: { match: unknown; differences: unknown[]; proposed: Pick<ProposedItem, "problems"> }): boolean {
  return !entry.match && !entry.differences.length && !entry.proposed.problems.length;
}
