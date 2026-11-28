import { DateTime } from "../time/luxon";
import { formatClock, toLocal } from "../time/format";
import type { ZonedTime } from "../types";
import type { TripView, VisibleItem } from "../visibility/project";
import { placeLabel } from "./labels";
import { smartKey, type SmartCheck } from "./types";

const EVENING_WORD = /\b(dinner|supper|drinks?|bar|shows?|concerts?)\b/i;
const MEAL_WORD = /\b(breakfast|brunch|lunch)\b/i;
const LAST_EARLY_EVENING_HOUR = 6;
const LAST_EARLY_MEAL_HOUR = 4;
const LAST_SMALL_HOUR = 5;
const HOME_DAY_START_MINUTES = 8 * 60;
const HOME_DAY_END_MINUTES = 22 * 60 + 59;

const PLURALS: Record<string, string> = { lunch: "Lunches", brunch: "Brunches", drinks: "Drinks", drink: "Drinks" };

function capitalised(word: string): string {
  return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
}

function plural(word: string): string {
  return PLURALS[word.toLowerCase()] ?? `${capitalised(word)}s`;
}

function wallClock(local: DateTime): string {
  return local.toFormat("yyyy-MM-dd'T'HH:mm:ss");
}

function inZone(wall: string, zone: string): ZonedTime {
  return { at: DateTime.fromISO(wall, { zone }).toUTC().toISO(), zone };
}

function afterTwelveHours(local: DateTime): DateTime {
  return DateTime.fromObject({ year: local.year, month: local.month, day: local.day, hour: local.hour + 12, minute: local.minute, second: local.second }, { zone: local.zoneName });
}

function keepingLength(item: VisibleItem, start: ZonedTime): { start: ZonedTime; end: ZonedTime } {
  const length = Date.parse(item.end.at) - Date.parse(item.start.at);
  return { start, end: { at: new Date(Date.parse(start.at) + length).toISOString(), zone: item.end.zone } };
}

function weekdayName(dt: DateTime): string {
  return dt.toFormat("cccc");
}

function slip(item: VisibleItem): { word: string } | null {
  const local = toLocal(item.start);
  const evening = EVENING_WORD.exec(item.title);
  if (evening?.[1] && local.hour <= LAST_EARLY_EVENING_HOUR) return { word: evening[1] };
  const meal = MEAL_WORD.exec(item.title);
  if (meal?.[1] && local.hour <= LAST_EARLY_MEAL_HOUR) return { word: meal[1] };
  return null;
}

function amPm(item: VisibleItem, view: TripView, word: string): SmartCheck {
  const local = toLocal(item.start);
  const shifted = afterTwelveHours(local);
  const home = local.setZone(view.homeZone);
  const start = inZone(wallClock(shifted), item.start.zone);
  const sameWallClockAsHome = home.offset === local.offset;
  const homeText = sameWallClockAsHome ? "" : ` (${formatClock(home)} ${weekdayName(home)} ${placeLabel(view.homeZone)})`;
  const was = formatClock(local);
  const now = formatClock(shifted);
  return {
    key: smartKey("wrong_time", [item], "ampm"),
    kind: "wrong_time",
    itemId: item.id,
    itemIds: [item.id],
    line: `${capitalised(word)} at ${was}? Did you mean ${now}?`,
    why: `${item.title} is set for ${was} ${placeLabel(item.start.zone)} time${homeText}. ${plural(word)} are rarely that early, so this may be ${now}${sameWallClockAsHome ? "" : `, or a time typed in ${placeLabel(view.homeZone)} time`}.`,
    fix: { label: `Change to ${now}`, done: `Changed to ${now}.`, ...keepingLength(item, start) },
  };
}

function zoneSlip(item: VisibleItem, view: TripView): SmartCheck | null {
  const local = toLocal(item.start);
  if (local.hour > LAST_SMALL_HOUR) return null;
  const home = local.setZone(view.homeZone);
  const minutes = home.hour * 60 + home.minute;
  if (minutes < HOME_DAY_START_MINUTES || minutes > HOME_DAY_END_MINUTES) return null;
  const start = inZone(wallClock(local), view.homeZone);
  const sameInstant = start.at === item.start.at;
  if (sameInstant) return null;
  const was = formatClock(local);
  const homeName = placeLabel(view.homeZone);
  const place = placeLabel(item.start.zone);
  return {
    key: smartKey("wrong_time", [item], "zone"),
    kind: "wrong_time",
    itemId: item.id,
    itemIds: [item.id],
    line: `${was} in ${place}. Did you mean ${was} ${homeName} time?`,
    why: `${item.title} is set for ${was} ${place} time (${formatClock(home)} ${weekdayName(home)} ${homeName}). That is early for a plan, so this may be a time typed in ${homeName} time.`,
    fix: { label: `Use ${homeName} time`, done: `Changed to ${was} ${homeName} time.`, ...keepingLength(item, { at: start.at, zone: item.start.zone }) },
  };
}

export function wrongTime(view: TripView): SmartCheck[] {
  const out: SmartCheck[] = [];
  for (const item of view.items) {
    if (item.type !== "plan") continue;
    const found = slip(item);
    const check = found ? amPm(item, view, found.word) : zoneSlip(item, view);
    if (check) out.push(check);
  }
  return out;
}
