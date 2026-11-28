import { DateTime } from "../time/luxon";
import { whereAt } from "../time/days";
import { flightCities } from "../time/flight-card";
import { formatClock, formatShortDate, formatWeekday, instantMs, toLocal } from "../time/format";
import type { TripView, VisibleItem } from "../visibility/project";

const byStart = (a: VisibleItem, b: VisibleItem) => instantMs(a.start) - instantMs(b.start);

function inYourTime(atMs: number, view: TripView, zoneKnown: boolean, localDate: string): string {
  if (!zoneKnown) return "";
  const mine = DateTime.fromMillis(atMs, { zone: view.homeZone });
  const day = mine.toISODate() === localDate ? "" : ` ${formatWeekday(mine)}`;
  return ` (${formatClock(mine)}${day} your time)`;
}

function daysUntil(startMs: number, nowMs: number, zone: string): number {
  const start = DateTime.fromMillis(startMs, { zone }).startOf("day");
  const now = DateTime.fromMillis(nowMs, { zone }).startOf("day");
  return Math.round(start.diff(now, "days").days);
}

export function visitorStatus(view: TripView, nowMs: number, zoneKnown: boolean): string | null {
  const items = view.items.filter((i) => i.status === "confirmed").sort(byStart);
  if (!items.length) return null;
  const first = items[0];
  const lastEnd = items.reduce((a, b) => (instantMs(b.end) > instantMs(a.end) ? b : a));

  if (nowMs < instantMs(first.start)) {
    const days = daysUntil(instantMs(first.start), nowMs, view.homeZone);
    if (days <= 0) return "They leave today.";
    return days === 1 ? "They leave in 1 day." : `They leave in ${days} days.`;
  }
  if (nowMs >= instantMs(lastEnd.end)) return `They were back on ${formatShortDate(toLocal(lastEnd.end))}.`;

  const flying = items.find((i) => i.type === "flight" && instantMs(i.start) <= nowMs && nowMs < instantMs(i.end));
  if (flying) {
    const to = flightCities(flying).to;
    const landsLocal = toLocal(flying.end);
    const where = to ? `In the air to ${to}.` : "In the air.";
    const lands = `Lands ${formatClock(landsLocal)}${to ? ` ${to}` : ""} time`;
    return `${where} ${lands}${inYourTime(instantMs(flying.end), view, zoneKnown, landsLocal.toISODate())}.`;
  }

  const where = whereAt(nowMs, view.items, view.homeZone);
  const clock = formatClock(DateTime.fromMillis(nowMs, { zone: where.zone }));
  return where.city ? `In ${where.city}. It is ${clock} there.` : `It is ${clock} where they are.`;
}
