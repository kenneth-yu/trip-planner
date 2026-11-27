import type { ItemPrivate, ItemType, Visibility, Zone, ZonedTime } from "../types";
import type { ItemPatch } from "../item-patch";
import type { ProposedItem } from "./proposal";
import type { VisibleItem } from "../visibility/project";
import { toLocal } from "../time/format";
import { airportByCode, airportsInCity } from "../time/places";
import { resolvePlace, type PlaceQuery } from "../time/resolve-place";
import { airlineFor } from "./airlines";
import { arrivalAfter, sameDayClockRoll } from "./arrival";
import { DEFAULT_CHECK_IN, DEFAULT_CHECK_OUT } from "./calendar-event";
import { ItemInput } from "./quick-add";

export type FormEntries = [string, string][];

export interface ItemFormValues {
  type: ItemType;
  fields: Record<string, string>;
  seats: { traveler: string; seat: string }[];
  visibility: Visibility;
  visibleToUserIds: string[];
  showAsBusy: boolean;
}

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
  place: "We can't find that place. Try an airport code like HND.",
  cityOrAddress: "Enter a city or address.",
  time: "Enter a time like 8:50am.",
  date: "Choose a date.",
  arrivalBeforeDeparture: "Arrival is before departure. If it lands the next day, check the date.",
  checkOutBeforeCheckIn: "Check out is before check in.",
  people: "Choose at least one person, or pick Everyone.",
  name: "Enter a name.",
  title: "Enter a title.",
  price: "Enter a price like $240.",
  tooLong: "That is too long.",
  tooMany: "Too many tries. Wait a minute and try again.",
} as const;

export type ZoneOf = (query: PlaceQuery, isoDate: string) => Zone | null;

export interface ParseOptions {
  memberIds?: readonly string[] | null;
  zoneOf?: ZoneOf;
}

const TRIP_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function parseTripId(value: unknown): string | null {
  return typeof value === "string" && TRIP_ID.test(value) ? value : null;
}

const FIELD_OF_KEY: Record<string, string> = {
  flightNumber: "flightNumber",
  name: "name",
  title: "title",
  address: "place",
  city: "place",
  fromCity: "from",
  toCity: "to",
  confirmationCode: "confirmationCode",
  bookingReference: "bookingReference",
  phone: "phone",
  price: "price",
  notes: "notes",
  airline: "airline",
};

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

function defaultZoneOf(query: PlaceQuery): Zone | null {
  const resolved = resolvePlace(query);
  return resolved.status === "unknown" ? null : resolved.zone;
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
  zoneOf: ZoneOf;
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
  const endsRaw = e.get("ends");
  const ends = endsRaw ? requireClock(e, "ends", p) : "";
  const endLocal = !p.errors.date && starts && ends ? sameDayClockRoll(date, starts, ends).local : undefined;
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
    const fromZone = p.zoneOf(placeQueryFor(from), date);
    const toZone = p.zoneOf(placeQueryFor(to), date);
    if (fromZone && toZone) {
      const arrival = arrivalAfter(`${date}T${departs}`, fromZone, arrives, toZone);
      if (arrival) endLocal = arrival.local;
      else p.errors.arrives = MESSAGES.arrivalBeforeDeparture;
    } else if (arrives > departs) {
      endLocal = `${date}T${arrives}`;
    } else {
      p.errors.arrives = MESSAGES.arrivalBeforeDeparture;
    }
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
    bookingReference: e.get("bookingReference") || undefined,
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

export function parseItemForm(entries: FormEntries, options: ParseOptions = {}): ItemFormResult {
  const e = new Entries(entries);
  const p: Parse = { fields: {}, errors: {}, zoneOf: options.zoneOf ?? defaultZoneOf };
  const type = ITEM_TYPES.find((t) => t === e.get("type"));
  if (type === "flight") flight(e, p);
  else if (type === "stay") stay(e, p);
  else if (type === "plan") plan(e, p);
  else if (type === "transfer") transfer(e, p);
  else p.errors.type = "Choose what you are adding.";
  details(e, p);
  const share = sharing(e, p, options.memberIds ?? null);
  if (Object.keys(p.errors).length) return { ok: false, errors: p.errors, values: entries };
  const parsed = ItemInput.safeParse(p.fields);
  if (!parsed.success) {
    const errors: Record<string, string> = {};
    for (const issue of parsed.error.issues) {
      const field = FIELD_OF_KEY[String(issue.path[0])];
      if (field && issue.code === "too_big") errors[field] = MESSAGES.tooLong;
    }
    return { ok: false, errors: Object.keys(errors).length ? errors : { form: FORM_ERROR }, values: entries };
  }
  return { ok: true, input: parsed.data, sharing: share };
}

const SYMBOL_OF_CURRENCY: Record<string, string> = { USD: "$", GBP: "£", EUR: "€", JPY: "¥" };

function priceText(price: { amount: string; currency: string }): string {
  const symbol = SYMBOL_OF_CURRENCY[price.currency];
  return symbol ? `${symbol}${price.amount}` : `${price.currency} ${price.amount}`;
}

function localDate(t: VisibleItem["start"]): string {
  return toLocal(t).toFormat("yyyy-LL-dd");
}

function localClock(t: VisibleItem["start"]): string {
  return toLocal(t).toFormat("HH:mm");
}

function placeText(location: VisibleItem["location"]): string {
  return location?.address ?? location?.city ?? "";
}

function typeFields(item: VisibleItem): Record<string, string> {
  if (item.type === "flight" && item.flight) {
    return {
      flightNumber: item.flight.flightNumber,
      ...(item.flight.airline && item.flight.airline !== airlineFor(item.flight.flightNumber) ? { airline: item.flight.airline } : {}),
      date: localDate(item.start),
      from: item.flight.fromAirport,
      to: item.flight.toAirport,
      departs: localClock(item.start),
      arrives: localClock(item.end),
    };
  }
  if (item.type === "stay") {
    return {
      name: item.stay?.propertyName ?? item.title,
      place: placeText(item.location),
      checkInDate: localDate(item.start),
      checkInTime: localClock(item.start),
      checkInEdited: item.startIsEstimated ? "0" : "1",
      checkOutDate: localDate(item.end),
      checkOutTime: localClock(item.end),
      checkOutEdited: item.endIsEstimated ? "0" : "1",
    };
  }
  if (item.type === "transfer") {
    return {
      from: item.transfer?.fromPlace?.city ?? "",
      to: item.transfer?.toPlace?.city ?? "",
      mode: item.transfer?.mode ?? "",
      date: localDate(item.start),
      departs: localClock(item.start),
      arrives: localClock(item.end),
    };
  }
  return {
    title: item.title,
    place: placeText(item.location),
    date: localDate(item.start),
    starts: localClock(item.start),
    ...(item.endIsEstimated ? {} : { ends: localClock(item.end) }),
  };
}

function firstOf(rows: ItemPrivate[], pick: (row: ItemPrivate) => string | undefined): string {
  for (const row of rows) {
    const value = pick(row);
    if (value) return value;
  }
  return "";
}

function privateFields(item: VisibleItem, travelers: { id: string }[]): Record<string, string> {
  const rows = item.private;
  const price = rows.find((r) => r.price)?.price;
  const notes = [...rows.flatMap((r) => (r.notes ? [r.notes] : [])), ...(item.notes ? [item.notes] : [])].join("\n\n");
  const shared = rows.find((r) => r.travelerId === null || !travelers.some((t) => t.id === r.travelerId));
  const codes: Record<string, string> =
    travelers.length <= 1
      ? { confirmationCode: firstOf(rows, (r) => r.confirmationCode) }
      : Object.fromEntries(travelers.map((t) => [`code:${t.id}`, rows.find((r) => r.travelerId === t.id)?.confirmationCode ?? shared?.confirmationCode ?? ""]));
  return {
    ...codes,
    bookingReference: firstOf(rows, (r) => r.bookingReference),
    phone: firstOf(rows, (r) => r.phone),
    price: price ? priceText(price) : "",
    notes,
  };
}

export function itemToFormValues(item: VisibleItem, travelers: { id: string; name: string }[]): ItemFormValues {
  const fields = { ...typeFields(item), ...privateFields(item, travelers) };
  const seats = travelers.flatMap((t) => {
    const seat = item.private.find((r) => r.travelerId === t.id)?.seat;
    return seat ? [{ traveler: t.id, seat }] : [];
  });
  return {
    type: item.type,
    fields: Object.fromEntries(Object.entries(fields).filter(([, v]) => v !== "")),
    seats,
    visibility: item.visibility,
    visibleToUserIds: item.visibleToUserIds,
    showAsBusy: item.showAsBusy,
  };
}

export function entriesOfValues(values: ItemFormValues): FormEntries {
  return [["type", values.type], ...Object.entries(values.fields), ...values.seats.map((s): [string, string] => [`seat:${s.traveler}`, s.seat])];
}

export type EditFormResult =
  | { ok: true; input: ItemInput; private: ItemPrivate[] }
  | { ok: false; errors: Record<string, string>; values: FormEntries };

export interface EditOptions extends ParseOptions {
  travelerIds: readonly string[];
  previous: readonly ItemPrivate[];
}

const CODE_MAX = 60;
const SEAT_MAX = 20;

function compact(row: ItemPrivate): ItemPrivate[] {
  const { travelerId, ...data } = row;
  return Object.values(data).some((v) => v !== undefined) ? [{ travelerId, ...data }] : [];
}

export function parseEditForm(entries: FormEntries, options: EditOptions): EditFormResult {
  const ids = options.travelerIds;
  const foreign = entries.some(([k]) => (k.startsWith("seat:") || k.startsWith("code:")) && !ids.includes(k.slice(k.indexOf(":") + 1)));
  if (foreign) return { ok: false, errors: { form: FORM_ERROR }, values: entries };
  const e = new Entries(entries);
  const errors: Record<string, string> = {};
  for (const id of ids) {
    if (e.get(`seat:${id}`).length > SEAT_MAX) errors[`seat:${id}`] = MESSAGES.tooLong;
    if (e.get(`code:${id}`).length > CODE_MAX) errors[`code:${id}`] = MESSAGES.tooLong;
  }
  const parsed = parseItemForm(entries, options);
  if (!parsed.ok) return { ok: false, errors: { ...parsed.errors, ...errors }, values: entries };
  if (Object.keys(errors).length) return { ok: false, errors, values: entries };
  const input = parsed.input;
  const single = ids.length === 1;
  const upper = (value: string | undefined): string | undefined => value?.toUpperCase();
  const perTraveler = ids.map((id) => ({ id, seat: upper(e.get(`seat:${id}`) || undefined), code: single ? undefined : upper(e.get(`code:${id}`) || undefined) }));
  const distinctCodes = [...new Set(perTraveler.flatMap((p) => (p.code ? [p.code] : [])))];
  const sharedCode = single ? upper(input.confirmationCode) : distinctCodes.length === 1 ? distinctCodes[0] : undefined;
  const sharedRow: ItemPrivate = {
    travelerId: single ? ids[0] : null,
    confirmationCode: sharedCode,
    bookingReference: upper(input.bookingReference),
    phone: input.phone,
    price: input.price,
    notes: input.notes,
    bookingSite: options.previous.find((r) => r.bookingSite)?.bookingSite,
  };
  if (single) return { ok: true, input, private: compact({ ...sharedRow, seat: perTraveler[0].seat }) };
  const rows = perTraveler.flatMap((p) => compact({ travelerId: p.id, seat: p.seat, confirmationCode: distinctCodes.length > 1 ? p.code : undefined }));
  return { ok: true, input, private: [...rows, ...compact(sharedRow)] };
}

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") {
    const entries = Object.entries(value)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => a.localeCompare(b));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`).join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

const sameValue = (a: unknown, b: unknown): boolean => canonical(a) === canonical(b);

function placeIdentity(location: { name?: string; address?: string; city?: string } | null | undefined) {
  return location ? { name: location.name, address: location.address, city: location.city } : null;
}

function sameMoment(a: ZonedTime, b: ZonedTime): boolean {
  return Date.parse(a.at) === Date.parse(b.at) && a.zone === b.zone;
}

export function editPatch(before: VisibleItem, proposal: ProposedItem, rows: ItemPrivate[]): ItemPatch {
  const patch: ItemPatch = {};
  const sameEndpoints = sameValue({ from: placeIdentity(proposal.transfer?.fromPlace), to: placeIdentity(proposal.transfer?.toPlace) }, { from: placeIdentity(before.transfer?.fromPlace), to: placeIdentity(before.transfer?.toPlace) });
  if (proposal.title !== before.title && !(before.type === "transfer" && sameEndpoints)) patch.title = proposal.title;
  if (!sameMoment(proposal.start, before.start) || proposal.startIsEstimated !== before.startIsEstimated) {
    patch.start = proposal.start;
    patch.startIsEstimated = proposal.startIsEstimated;
  }
  if (!sameMoment(proposal.end, before.end) || proposal.endIsEstimated !== before.endIsEstimated) {
    patch.end = proposal.end;
    patch.endIsEstimated = proposal.endIsEstimated;
  }
  if (!sameValue(placeIdentity(proposal.location), placeIdentity(before.location))) patch.location = proposal.location;
  if (proposal.flight && !sameValue(proposal.flight, before.flight)) patch.flight = proposal.flight;
  const stay = proposal.stay && { ...proposal.stay, lateArrivalCutoff: before.stay?.lateArrivalCutoff };
  if (stay && !sameValue(stay, before.stay)) patch.stay = stay;
  if (proposal.transfer && !sameValue({ mode: proposal.transfer.mode, from: placeIdentity(proposal.transfer.fromPlace), to: placeIdentity(proposal.transfer.toPlace) }, { mode: before.transfer?.mode, from: placeIdentity(before.transfer?.fromPlace), to: placeIdentity(before.transfer?.toPlace) })) {
    patch.transfer = proposal.transfer;
  }
  if (patch.start || patch.end || patch.location) {
    patch.flags = proposal.problems;
    patch.status = proposal.status;
  }
  if (!sameValue(rows, before.private) || before.notes !== "") {
    patch.private = rows;
    patch.notes = "";
  }
  return patch;
}
