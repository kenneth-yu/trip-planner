import type { ItemType, Visibility, Zone } from "../types";
import { airportByCode, airportsInCity } from "../time/places";
import { resolvePlace } from "../time/resolve-place";
import { airlineFor } from "./airlines";
import { arrivalAfter } from "./arrival";
import { DEFAULT_CHECK_IN, DEFAULT_CHECK_OUT } from "./calendar-event";
import { ItemInput } from "./quick-add";

export type FormEntries = [string, string][];

export interface FormSharing {
  visibility: Visibility;
  visibleToUserIds: string[];
  showAsBusy: boolean;
}

export type ItemFormResult =
  | { ok: true; input: ItemInput; sharing: FormSharing }
  | { ok: false; errors: Record<string, string>; values: FormEntries };

export const FORM_ERROR = "That did not save. Your entries are still here. Try again.";

export const MESSAGES = {
  flightNumber: "Enter the flight number.",
  flightNumberShape: "That does not look like a flight number. Try NH 159.",
  place: "We cannot find that place. Try the airport code, like HND.",
  cityOrAddress: "Enter a city or address.",
  time: "Enter a time like 8:50am.",
  date: "Choose a date.",
  arrivalBeforeDeparture: "Arrival is before departure. If it lands the next day, check the date.",
  checkOutBeforeCheckIn: "Check out is before check in.",
  people: "Choose at least one person, or pick Everyone.",
  name: "Enter a name.",
  title: "Enter a title.",
  price: "Enter a price like $240.",
} as const;

export const ITEM_TYPES: ItemType[] = ["flight", "stay", "plan", "transfer"];

const MODES = ["train", "ferry", "car", "bus", "border", "other"] as const;
const CURRENCY_SYMBOLS: Record<string, string> = { $: "USD", "£": "GBP", "€": "EUR", "¥": "JPY" };

export function parseClock(text: string): string | null {
  const value = text.trim().toLowerCase();
  if (value === "noon") return "12:00";
  if (value === "midnight") return "00:00";
  const twentyFour = /^(\d{1,2}):(\d{2})$/.exec(value);
  if (twentyFour) return clockOf(Number(twentyFour[1]), Number(twentyFour[2]));
  const twelve = /^(\d{1,2})(?::(\d{2}))?\s*(am|pm)$/.exec(value);
  if (!twelve) return null;
  const hour = Number(twelve[1]);
  if (hour < 1 || hour > 12) return null;
  return clockOf((hour % 12) + (twelve[3] === "pm" ? 12 : 0), Number(twelve[2] ?? "0"));
}

function clockOf(hour: number, minute: number): string | null {
  if (hour > 23 || minute > 59) return null;
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

function validDate(text: string): boolean {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text);
  if (!m) return false;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const date = new Date(Date.UTC(y, mo - 1, d));
  return date.getUTCFullYear() === y && date.getUTCMonth() === mo - 1 && date.getUTCDate() === d;
}

export function airportFor(text: string): string | null {
  const value = text.trim();
  if (!value) return null;
  if (/^[a-z]{3}$/i.test(value)) return airportByCode(value)?.iata ?? null;
  const token = value.match(/\b[A-Z]{3}\b/g)?.find((code) => airportByCode(code));
  if (token) return token;
  const codes = [...new Set(airportsInCity(value).map((a) => a.iata))];
  return codes.length === 1 ? codes[0] : null;
}

export function placeQueryFor(text: string): { city?: string; address?: string } {
  const value = text.trim();
  return /[,\d]/.test(value) ? { address: value } : { city: value };
}

function zoneOfPlace(text: string): Zone {
  const resolved = resolvePlace(placeQueryFor(text));
  return resolved.status === "unknown" ? "UTC" : resolved.zone;
}

function parsePrice(text: string): { amount: string; currency: string } | null {
  const value = text.trim();
  const symbol = CURRENCY_SYMBOLS[value.charAt(0)];
  const leading = /^([a-z]{3})\s*([\d.,]+)$/i.exec(value);
  const trailing = /^([\d.,]+)\s*([a-z]{3})$/i.exec(value);
  const currency = symbol ?? leading?.[1] ?? trailing?.[2] ?? "USD";
  const rawNumber = symbol ? value.slice(1) : (leading?.[2] ?? trailing?.[1] ?? value);
  const number = rawNumber.replace(/[,\s]/g, "");
  if (!/^\d+(\.\d{1,2})?$/.test(number)) return null;
  return { amount: number, currency: currency.toUpperCase() };
}

class Entries {
  private readonly map = new Map<string, string>();
  readonly all: FormEntries;

  constructor(entries: FormEntries) {
    this.all = entries;
    for (const [k, v] of entries) if (!this.map.has(k)) this.map.set(k, v.trim());
  }

  get(name: string): string {
    return this.map.get(name) ?? "";
  }

  many(name: string): string[] {
    return this.all.filter(([k]) => k === name).map(([, v]) => v.trim()).filter(Boolean);
  }

  withPrefix(prefix: string): [string, string][] {
    return this.all.filter(([k]) => k.startsWith(prefix)).map(([k, v]) => [k.slice(prefix.length), v.trim()]);
  }
}

type Fields = Record<string, unknown>;

interface Parse {
  fields: Fields;
  errors: Record<string, string>;
}

function requireDate(e: Entries, name: string, p: Parse): string {
  const v = e.get(name);
  if (!validDate(v)) p.errors[name] = MESSAGES.date;
  return v;
}

function requireClock(e: Entries, name: string, p: Parse): string {
  const v = parseClock(e.get(name));
  if (!v) {
    p.errors[name] = MESSAGES.time;
    return "";
  }
  return v;
}

function flight(e: Entries, p: Parse): void {
  const number = e.get("flightNumber");
  if (!number) p.errors.flightNumber = MESSAGES.flightNumber;
  else if (!/^[A-Z0-9]{2}\s?\d{1,4}$/i.test(number)) p.errors.flightNumber = MESSAGES.flightNumberShape;
  const from = airportFor(e.get("from"));
  const to = airportFor(e.get("to"));
  if (!from) p.errors.from = MESSAGES.place;
  if (!to) p.errors.to = MESSAGES.place;
  const date = requireDate(e, "date", p);
  const departs = requireClock(e, "departs", p);
  const arrives = requireClock(e, "arrives", p);
  const airline = e.get("airline") || airlineFor(number) || undefined;
  const fromZone = from ? airportByCode(from)?.zone : undefined;
  const toZone = to ? airportByCode(to)?.zone : undefined;
  let arriveLocal = "";
  if (fromZone && toZone && !p.errors.date && departs && arrives) {
    const arrival = arrivalAfter(`${date}T${departs}`, fromZone, arrives, toZone);
    if (arrival) arriveLocal = arrival.local;
    else p.errors.arrives = MESSAGES.arrivalBeforeDeparture;
  }
  const seats = e
    .withPrefix("seat:")
    .filter(([, seat]) => seat)
    .map(([traveler, seat]) => ({ traveler, seat }));
  Object.assign(p.fields, {
    type: "flight",
    flightNumber: number,
    airline,
    fromAirport: from ?? "",
    toAirport: to ?? "",
    departLocal: `${date}T${departs}`,
    arriveLocal,
    seats: seats.length ? seats : undefined,
  });
}

function stay(e: Entries, p: Parse): void {
  const name = e.get("name");
  if (!name) p.errors.name = MESSAGES.name;
  const place = e.get("place");
  if (!place) p.errors.place = MESSAGES.cityOrAddress;
  const inDate = requireDate(e, "checkInDate", p);
  const outDate = requireDate(e, "checkOutDate", p);
  const inEdited = e.get("checkInEdited") === "1";
  const outEdited = e.get("checkOutEdited") === "1";
  const inRaw = e.get("checkInTime");
  const outRaw = e.get("checkOutTime");
  const inTime = inRaw ? requireClock(e, "checkInTime", p) : "";
  const outTime = outRaw ? requireClock(e, "checkOutTime", p) : "";
  const checkIn = inTime && (inEdited || inTime !== DEFAULT_CHECK_IN) ? inTime : undefined;
  const checkOut = outTime && (outEdited || outTime !== DEFAULT_CHECK_OUT) ? outTime : undefined;
  if (!p.errors.checkInDate && !p.errors.checkOutDate && !p.errors.checkInTime && !p.errors.checkOutTime) {
    const start = `${inDate}T${checkIn ?? DEFAULT_CHECK_IN}`;
    const end = `${outDate}T${checkOut ?? DEFAULT_CHECK_OUT}`;
    if (end <= start) p.errors.checkOutDate = MESSAGES.checkOutBeforeCheckIn;
  }
  Object.assign(p.fields, {
    type: "stay",
    name,
    ...placeQueryFor(place),
    checkInDate: inDate,
    checkInTime: checkIn,
    checkOutDate: outDate,
    checkOutTime: checkOut,
  });
}

function plan(e: Entries, p: Parse): void {
  const title = e.get("title");
  if (!title) p.errors.title = MESSAGES.title;
  const place = e.get("place");
  if (!place) p.errors.place = MESSAGES.cityOrAddress;
  const date = requireDate(e, "date", p);
  const starts = requireClock(e, "starts", p);
  const ends = requireClock(e, "ends", p);
  let endLocal = "";
  if (!p.errors.date && starts && ends) {
    const zone = place ? zoneOfPlace(place) : "UTC";
    if (ends >= starts) endLocal = `${date}T${ends}`;
    else endLocal = arrivalAfter(`${date}T${starts}`, zone, ends, zone)?.local ?? "";
    if (!endLocal) p.errors.ends = MESSAGES.arrivalBeforeDeparture;
  }
  Object.assign(p.fields, { type: "plan", title, ...placeQueryFor(place), startLocal: `${date}T${starts}`, endLocal });
}

function transfer(e: Entries, p: Parse): void {
  const from = e.get("from");
  const to = e.get("to");
  if (!from) p.errors.from = MESSAGES.cityOrAddress;
  if (!to) p.errors.to = MESSAGES.cityOrAddress;
  const date = requireDate(e, "date", p);
  const departs = requireClock(e, "departs", p);
  const arrives = requireClock(e, "arrives", p);
  const mode = MODES.find((m) => m === e.get("mode"));
  let endLocal = "";
  if (from && to && !p.errors.date && departs && arrives) {
    const arrival = arrivalAfter(`${date}T${departs}`, zoneOfPlace(from), arrives, zoneOfPlace(to));
    if (arrival) endLocal = arrival.local;
    else p.errors.arrives = MESSAGES.arrivalBeforeDeparture;
  }
  Object.assign(p.fields, { type: "transfer", mode, fromCity: from, toCity: to, startLocal: `${date}T${departs}`, endLocal });
}

function details(e: Entries, p: Parse): void {
  const price = e.get("price");
  const parsedPrice = price ? parsePrice(price) : undefined;
  if (price && !parsedPrice) p.errors.price = MESSAGES.price;
  const deadlineDate = e.get("deadlineDate");
  let deadlines: Fields[] | undefined;
  if (deadlineDate) {
    if (!validDate(deadlineDate)) p.errors.deadlineDate = MESSAGES.date;
    const time = e.get("deadlineTime") ? requireClock(e, "deadlineTime", p) : "23:59";
    if (!p.errors.deadlineDate && time) deadlines = [{ kind: "free_cancellation", local: `${deadlineDate}T${time}` }];
  }
  Object.assign(p.fields, {
    confirmationCode: e.get("confirmationCode") || undefined,
    phone: e.get("phone") || undefined,
    price: parsedPrice ?? undefined,
    notes: e.get("notes") || undefined,
    deadlines,
  });
}

function sharing(e: Entries, p: Parse, memberIds: readonly string[] | null): FormSharing {
  const raw = e.get("visibility");
  const visibility: Visibility = raw === "only_me" || raw === "specific" ? raw : "everyone";
  const picked = e.many("person").filter((id) => !memberIds || memberIds.includes(id));
  if (visibility === "specific" && picked.length === 0) p.errors.person = MESSAGES.people;
  return {
    visibility,
    visibleToUserIds: visibility === "specific" ? [...new Set(picked)] : [],
    showAsBusy: visibility !== "everyone" && e.get("showAsBusy") === "on",
  };
}

export function parseItemForm(entries: FormEntries, memberIds: readonly string[] | null = null): ItemFormResult {
  const e = new Entries(entries);
  const p: Parse = { fields: {}, errors: {} };
  const type = ITEM_TYPES.find((t) => t === e.get("type"));
  if (type === "flight") flight(e, p);
  else if (type === "stay") stay(e, p);
  else if (type === "plan") plan(e, p);
  else if (type === "transfer") transfer(e, p);
  else p.errors.type = "Choose what you are adding.";
  details(e, p);
  const share = sharing(e, p, memberIds);
  if (Object.keys(p.errors).length) return { ok: false, errors: p.errors, values: entries };
  const parsed = ItemInput.safeParse(p.fields);
  if (!parsed.success) return { ok: false, errors: { form: FORM_ERROR }, values: entries };
  return { ok: true, input: parsed.data, sharing: share };
}
