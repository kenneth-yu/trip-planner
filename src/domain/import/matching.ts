import { DateTime } from "../time/luxon";
import type { Item, ItemPrivate } from "../types";
import { formatClock, instantMs, localDateKey, toLocal } from "../time/format";
import type { Difference, ProposedDeadline, ProposedItem } from "./proposal";

export type Mergeable = Omit<ProposedItem, "problems" | "deadlines"> & {
  deadlines: (ProposedDeadline | Item["deadlines"][number])[];
  problems?: string[];
};

export interface Match {
  strength: "strong" | "possible";
  differences: Difference[];
}

const TWO_HOURS = 2 * 3600_000;
const COMMON_WORDS = new Set(["hotel", "the", "stay", "at", "a", "an", "and", "of", "in", "inn", "airbnb", "by", "room", "rooms"]);

export class Memo {
  private readonly names = new Map<string, readonly string[]>();
  private readonly days = new Map<string, string>();
  private readonly instants = new Map<string, number>();

  words(title: string): readonly string[] {
    const known = this.names.get(title);
    if (known) return known;
    const value = normalizeName(title);
    this.names.set(title, value);
    return value;
  }

  day(t: Mergeable["start"]): string {
    const key = `${t.at}|${t.zone}`;
    const known = this.days.get(key);
    if (known !== undefined) return known;
    const value = localDateKey(t);
    this.days.set(key, value);
    return value;
  }

  instant(t: Mergeable["start"]): number {
    const known = this.instants.get(t.at);
    if (known !== undefined) return known;
    const parsed = Date.parse(t.at);
    const value = Number.isNaN(parsed) ? instantMs(t) : parsed;
    this.instants.set(t.at, value);
    return value;
  }
}

export function normalizeName(s: string): readonly string[] {
  return s
    .toLowerCase()
    .replace(/\([^)]*\)/g, " ")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .split(/\s+/)
    .filter((w) => w && !COMMON_WORDS.has(w));
}

export function similarNames(a: string, b: string, memo: Memo = new Memo()): boolean {
  const [x, y] = [memo.words(a), memo.words(b)];
  if (!x.length || !y.length) return false;
  const shared = x.filter((w) => y.includes(w)).length;
  return shared / Math.min(x.length, y.length) >= 0.6;
}

function nightsOverlap(a: Mergeable, b: Mergeable, memo: Memo): boolean {
  const [as, ae, bs, be] = [memo.day(a.start), memo.day(a.end), memo.day(b.start), memo.day(b.end)];
  return as < be && bs < ae;
}

function timesOverlap(a: Mergeable, b: Mergeable, memo: Memo): boolean {
  return memo.instant(a.start) < memo.instant(b.end) && memo.instant(b.start) < memo.instant(a.end);
}

const showTime = (t: Mergeable["start"]) => formatClock(toLocal(t));

export function sharedDifferences(existing: Mergeable, incoming: Mergeable): Difference[] {
  const out: Difference[] = [];
  const timeField = (field: "start" | "end", estA: boolean, estB: boolean) => {
    const [a, b] = [existing[field], incoming[field]];
    if (a.at === b.at || estA || estB) return;
    const sameDay = localDateKey(a) === localDateKey(b);
    const fmt = (t: typeof a) => (sameDay ? showTime(t) : `${toLocal(t).toFormat("LLL d")} ${showTime(t)}`);
    out.push({ field, values: [fmt(a), fmt(b)], options: [a, b] });
  };
  timeField("start", existing.startIsEstimated, incoming.startIsEstimated);
  timeField("end", existing.endIsEstimated, incoming.endIsEstimated);
  if (existing.flight && incoming.flight) {
    for (const f of ["fromAirport", "toAirport"] as const) {
      const [a, b] = [existing.flight[f], incoming.flight[f]];
      if (a && b && a !== b) out.push({ field: f, values: [a, b], options: [a, b] });
    }
  }
  return out;
}

export function matchRecords(existing: Mergeable, incoming: Mergeable, memo: Memo = new Memo()): Match | null {
  if (existing.type !== incoming.type) return null;
  switch (incoming.type) {
    case "flight": {
      const [a, b] = [existing.flight, incoming.flight];
      if (!a || !b || a.flightNumber !== b.flightNumber) return null;
      if (Math.abs(memo.instant(existing.start) - memo.instant(incoming.start)) > TWO_HOURS) return null;
      if (memo.day(existing.start) !== memo.day(incoming.start)) return null;
      return { strength: "strong", differences: sharedDifferences(existing, incoming) };
    }
    case "stay": {
      if (!nightsOverlap(existing, incoming, memo)) return null;
      const nameMatch =
        similarNames(existing.title, incoming.title, memo) ||
        Boolean(existing.location?.address && incoming.location?.address && similarNames(existing.location.address, incoming.location.address, memo));
      if (nameMatch) return { strength: "strong", differences: sharedDifferences(existing, incoming) };
      if (!incoming.location?.address && !incoming.location?.city && existing.start.zone === incoming.start.zone) {
        return { strength: "possible", differences: [] };
      }
      return null;
    }
    case "plan":
    case "transfer": {
      if (!timesOverlap(existing, incoming, memo)) return null;
      if (memo.day(existing.start) !== memo.day(incoming.start)) return null;
      if (!similarNames(existing.title, incoming.title, memo)) return null;
      return { strength: "strong", differences: sharedDifferences(existing, incoming) };
    }
  }
}

const PRIVATE_KEYS = ["confirmationCode", "bookingReference", "seat", "phone", "price", "bookingSite", "notes"] as const satisfies readonly (keyof ItemPrivate)[];

function fillField<K extends (typeof PRIVATE_KEYS)[number]>(target: ItemPrivate, source: ItemPrivate, key: K) {
  if (target[key] === undefined && source[key] !== undefined) target[key] = source[key];
}

function fillMissing(target: ItemPrivate, source: ItemPrivate) {
  for (const key of PRIVATE_KEYS) fillField(target, source, key);
}

function hasPrivateData(p: ItemPrivate): boolean {
  return Object.entries(p).some(([k, v]) => k !== "travelerId" && v !== undefined);
}

export function mergePrivate(existing: Mergeable, incoming: Mergeable): ItemPrivate[] {
  const rows = existing.private.map((p) => ({ ...p }));
  const same = (a: ItemPrivate, b: ItemPrivate) =>
    a.seat === b.seat && a.confirmationCode === b.confirmationCode && a.bookingReference === b.bookingReference;
  for (const row of incoming.private.filter(hasPrivateData)) {
    if (rows.some((r) => same(r, row))) continue;
    let travelerId = row.travelerId;
    if (!travelerId) {
      const free = incoming.travelerIds.filter((t) => !rows.some((r) => r.travelerId === t));
      travelerId = free.length === 1 ? free[0] : null;
    }
    const target = travelerId ? rows.find((r) => r.travelerId === travelerId) : undefined;
    if (target) fillMissing(target, row);
    else rows.push({ ...row, travelerId });
  }
  return rows;
}

export type Choices = Partial<Record<Difference["field"], number>>;

export function applyDifference(target: Pick<Mergeable, "start" | "end" | "flight">, d: Difference, pick: number): void {
  if (d.field === "start" || d.field === "end") target[d.field] = d.options[pick];
  else if (target.flight) target.flight = { ...target.flight, [d.field]: d.options[pick] };
}

function addOptions<T>(known: { values: string[]; options: T[] }, more: { values: string[]; options: T[] }) {
  more.options.forEach((o, j) => {
    if (!known.options.some((k) => JSON.stringify(k) === JSON.stringify(o))) {
      known.options.push(o);
      known.values.push(more.values[j]);
    }
  });
}

export function mergeDifference(known: Difference, more: Difference): void {
  if ((known.field === "start" || known.field === "end") && (more.field === "start" || more.field === "end")) addOptions(known, more);
  else if ((known.field === "fromAirport" || known.field === "toAirport") && (more.field === "fromAirport" || more.field === "toAirport")) addOptions(known, more);
}

export function mergeRecords<T extends Mergeable>(existing: T, incoming: Mergeable, differences: Difference[], choices: Choices): T {
  const merged: T = structuredClone(existing);
  for (const d of differences) applyDifference(merged, d, choices[d.field] ?? 0);
  if (merged.startIsEstimated && !incoming.startIsEstimated) {
    merged.start = incoming.start;
    merged.startIsEstimated = false;
  }
  if (merged.endIsEstimated && !incoming.endIsEstimated) {
    merged.end = incoming.end;
    merged.endIsEstimated = false;
  }
  merged.travelerIds = [...new Set([...existing.travelerIds, ...incoming.travelerIds])];
  merged.private = mergePrivate(existing, incoming);
  const seen = new Set(existing.deadlines.map((d) => `${d.kind}@${d.at.at}`));
  merged.deadlines = [...existing.deadlines, ...incoming.deadlines.filter((d) => !seen.has(`${d.kind}@${d.at.at}`))];
  if (incoming.flight && merged.flight) {
    merged.flight = { ...merged.flight, airline: merged.flight.airline ?? incoming.flight.airline };
  }
  if (incoming.stay && merged.stay) {
    merged.stay = { ...merged.stay, lateArrivalCutoff: merged.stay.lateArrivalCutoff ?? incoming.stay.lateArrivalCutoff };
  }
  if (!merged.location?.address && incoming.location?.address) merged.location = { ...merged.location, ...incoming.location };
  if (incoming.notes && !merged.notes.includes(incoming.notes)) merged.notes = [merged.notes, incoming.notes].filter(Boolean).join("\n\n");
  return merged;
}

export interface Cluster {
  proposed: ProposedItem;
  sources: number[];
  differences: Difference[];
}

function bucketKey(p: ProposedItem, memo: Memo): string {
  if (p.type === "stay") return "stay";
  const day = memo.day(p.start);
  return p.type === "flight" ? `flight|${p.flight?.flightNumber ?? ""}|${day}` : `${p.type}|${day}`;
}

export function consolidate(records: ProposedItem[]): Cluster[] {
  const clusters: Cluster[] = [];
  const buckets = new Map<string, Cluster[]>();
  const memo = new Memo();
  records.forEach((rec, i) => {
    const key = bucketKey(rec, memo);
    const bucket = buckets.get(key) ?? [];
    const target = bucket.find((c) => matchRecords(c.proposed, rec, memo)?.strength === "strong");
    if (!target) {
      const created: Cluster = { proposed: structuredClone(rec), sources: [i], differences: [] };
      clusters.push(created);
      bucket.push(created);
      buckets.set(key, bucket);
      return;
    }
    const diffs = sharedDifferences(target.proposed, rec);
    for (const d of diffs) {
      const known = target.differences.find((x) => x.field === d.field);
      if (known) mergeDifference(known, d);
      else target.differences.push(d);
    }
    const merged = mergeRecords(target.proposed, rec, [], {});
    merged.problems = [...new Set([...target.proposed.problems, ...rec.problems])];
    merged.status = target.proposed.status === "confirmed" || rec.status === "confirmed" ? "confirmed" : "needs_review";
    if (!target.proposed.flight?.airline && rec.flight?.airline && merged.flight) merged.flight.airline = rec.flight.airline;
    target.proposed = merged;
    target.sources.push(i);
  });
  return clusters;
}

export const shortDay = (t: Mergeable["start"]) => DateTime.fromISO(t.at).setZone(t.zone).toFormat("LLL d");
