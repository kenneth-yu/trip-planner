import { itemCity, whereAt, type Day } from "../time/days";
import { formatClock, formatDayHeader, formatShortDate, instantMs, localDateKey } from "../time/format";
import { DateTime } from "../time/luxon";
import { cityZone } from "../time/places";
import { resolvePlace } from "../time/resolve-place";
import type { Location, Requester, Visibility, Zone } from "../types";
import type { TripView } from "../visibility/project";

export type IdeaState = "open" | "done" | "dropped";

export interface Idea {
  id: string;
  tripId: string;
  title: string;
  location: Location | null;
  city: string | null;
  note: string;
  visibility: Visibility;
  visibleToUserIds: string[];
  state: IdeaState;
  createdBy: string | null;
  doneBy: string | null;
  doneAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export const ANYWHERE = "Anywhere";
export const MAX_SUGGESTIONS = 4;
const DAY_STARTS = 9;
const DAY_ENDS = 21;
const MIN_GAP_MINUTES = 120;

export function canSeeIdea(idea: Idea, requester: Requester): boolean {
  if (requester.kind !== "member") return false;
  if (idea.createdBy !== null && idea.createdBy === requester.userId) return true;
  if (idea.visibility === "everyone") return true;
  return idea.visibility === "specific" && idea.visibleToUserIds.includes(requester.userId);
}

export function ideaCity(idea: Pick<Idea, "city" | "location">): string | null {
  if (idea.city) return idea.city;
  if (idea.location?.city) return idea.location.city;
  const text = [idea.location?.address, idea.location?.name].filter(Boolean).join(", ");
  if (!text) return null;
  const resolved = resolvePlace({ address: text });
  return resolved.status === "unknown" ? null : resolved.city;
}

export interface IdeaGroup {
  city: string | null;
  title: string;
  ideas: Idea[];
}

function dayCities(view: TripView, days: Day[]): Map<string, { first: string; last: string }> {
  const cities = new Map<string, { first: string; last: string }>();
  const note = (city: string | null, first: string, last: string) => {
    if (!city) return;
    const seen = cities.get(city);
    cities.set(city, { first: seen && seen.first < first ? seen.first : first, last: seen && seen.last > last ? seen.last : last });
  };
  for (const day of days) note(sleepCity(day), day.key, day.key);
  for (const item of view.items) if (item.type === "stay") note(itemCity(item), localDateKey(item.start), localDateKey(item.end));
  return new Map([...cities].sort((a, b) => a[1].first.localeCompare(b[1].first)));
}

export function sleepCity(day: Pick<Day, "place">): string | null {
  if (!day.place) return null;
  return day.place.includes(" to ") ? (day.place.split(" to ").at(-1) ?? null) : day.place;
}

export function otherCity(day: Pick<Day, "place">): string | null {
  return day.place?.includes(" to ") ? (day.place.split(" to ")[0] ?? null) : null;
}

const rangeTitle = (city: string, first: string, last: string) => {
  const a = DateTime.fromISO(first);
  const b = DateTime.fromISO(last);
  const dates = a.toISODate() === b.toISODate() ? formatShortDate(a) : a.month === b.month ? `${formatShortDate(a)} to ${b.day}` : `${formatShortDate(a)} to ${formatShortDate(b)}`;
  return `${city}, ${dates}`;
};

export function groupIdeas(view: TripView, days: Day[], ideas: Idea[]): IdeaGroup[] {
  const route = dayCities(view, days);
  const byCity = new Map<string | null, Idea[]>();
  for (const idea of ideas) {
    const city = ideaCity(idea);
    byCity.set(city, [...(byCity.get(city) ?? []), idea]);
  }
  const groups: IdeaGroup[] = [];
  for (const [city, span] of route) {
    const list = byCity.get(city);
    if (list) groups.push({ city, title: rangeTitle(city, span.first, span.last), ideas: list });
    byCity.delete(city);
  }
  for (const [city, list] of byCity) if (city !== null) groups.push({ city, title: city, ideas: list });
  const anywhere = byCity.get(null);
  if (anywhere) groups.push({ city: null, title: ANYWHERE, ideas: anywhere });
  return groups;
}

export interface DayIdeas {
  city: string;
  line: string;
  ideas: Idea[];
}

export function ideasForDay(day: Pick<Day, "place">, ideas: Idea[]): DayIdeas[] {
  const found: DayIdeas[] = [];
  for (const city of [sleepCity(day), otherCity(day)]) {
    if (!city) continue;
    const list = ideas.filter((idea) => idea.state === "open" && ideaCity(idea) === city);
    if (list.length > 0) found.push({ city, line: `${list.length} ${list.length === 1 ? "idea" : "ideas"} for ${city}`, ideas: list });
  }
  return found;
}

export interface FreeTime {
  dayKey: string;
  startLocal: string;
  endLocal: string | null;
  label: string;
}

function cityZoneOf(view: TripView, city: string, atMs: number): Zone {
  return cityZone(city) ?? whereAt(atMs, view.items.filter((item) => itemCity(item) === city), view.homeZone).zone;
}

export function freeTime(view: TripView, days: Day[], city: string): FreeTime[] {
  const found: FreeTime[] = [];
  const taken = [...view.items.filter((item) => item.type !== "stay").map((item) => [instantMs(item.start), instantMs(item.end)] as const), ...view.busy.map((block) => [instantMs(block.start), instantMs(block.end)] as const)];
  for (const day of days) {
    if (sleepCity(day) !== city || day.place?.includes(" to ")) continue;
    const zone = cityZoneOf(view, city, DateTime.fromISO(`${day.key}T12:00`, { zone: view.homeZone }).toMillis());
    const open = DateTime.fromISO(`${day.key}T${String(DAY_STARTS).padStart(2, "0")}:00`, { zone });
    const close = DateTime.fromISO(`${day.key}T${String(DAY_ENDS).padStart(2, "0")}:00`, { zone });
    const blocks = taken
      .map(([start, end]) => [Math.max(start, open.toMillis()), Math.min(end, close.toMillis())] as const)
      .filter(([start, end]) => end > start)
      .sort((a, b) => a[0] - b[0]);
    let cursor = open.toMillis();
    const gaps: [number, number][] = [];
    for (const [start, end] of blocks) {
      if (start > cursor) gaps.push([cursor, start]);
      cursor = Math.max(cursor, end);
    }
    if (close.toMillis() > cursor) gaps.push([cursor, close.toMillis()]);
    for (const [start, end] of gaps) {
      if ((end - start) / 60_000 < MIN_GAP_MINUTES) continue;
      const from = DateTime.fromMillis(start, { zone });
      const to = DateTime.fromMillis(end, { zone });
      const wholeDay = start === open.toMillis() && end === close.toMillis();
      found.push({
        dayKey: day.key,
        startLocal: from.toFormat("yyyy-LL-dd'T'HH:mm"),
        endLocal: wholeDay ? null : to.toFormat("yyyy-LL-dd'T'HH:mm"),
        label: wholeDay ? `${formatDayHeader(from)}, all day` : `${formatDayHeader(from)}, ${formatClock(from)} to ${formatClock(to)}`,
      });
    }
  }
  return found.slice(0, MAX_SUGGESTIONS);
}
