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

export function normalizeName(s: string): string[] {
  return s
    .toLowerCase()
    .replace(/\([^)]*\)/g, " ")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .split(/\s+/)
    .filter((w) => w && !COMMON_WORDS.has(w));
}

export function similarNames(a: string, b: string): boolean {
  const [x, y] = [normalizeName(a), normalizeName(b)];
  if (!x.length || !y.length) return false;
  const shared = x.filter((w) => y.includes(w)).length;
  return shared / Math.min(x.length, y.length) >= 0.6;
}

function nightsOverlap(a: Mergeable, b: Mergeable): boolean {
  const [as, ae, bs, be] = [localDateKey(a.start), localDateKey(a.end), localDateKey(b.start), localDateKey(b.end)];
  return as < be && bs < ae;
}

function timesOverlap(a: Mergeable, b: Mergeable): boolean {
  return instantMs(a.start) < instantMs(b.end) && instantMs(b.start) < instantMs(a.end);
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

export function matchRecords(existing: Mergeable, incoming: Mergeable): Match | null {
  if (existing.type !== incoming.type) return null;
  switch (incoming.type) {
    case "flight": {
      const [a, b] = [existing.flight, incoming.flight];
      if (!a || !b || a.flightNumber !== b.flightNumber) return null;
      if (localDateKey(existing.start) !== localDateKey(incoming.start)) return null;
      if (Math.abs(instantMs(existing.start) - instantMs(incoming.start)) > TWO_HOURS) return null;
      return { strength: "strong", differences: sharedDifferences(existing, incoming) };
    }
    case "stay": {
      if (!nightsOverlap(existing, incoming)) return null;
      const nameMatch =
        similarNames(existing.title, incoming.title) ||
        Boolean(existing.location?.address && incoming.location?.address && similarNames(existing.location.address, incoming.location.address));
      if (nameMatch) return { strength: "strong", differences: sharedDifferences(existing, incoming) };
      if (!incoming.location?.address && !incoming.location?.city && existing.start.zone === incoming.start.zone) {
        return { strength: "possible", differences: [] };
      }
      return null;
    }
    case "plan":
    case "transfer": {
      if (localDateKey(existing.start) !== localDateKey(incoming.start)) return null;
      if (!timesOverlap(existing, incoming) || !similarNames(existing.title, incoming.title)) return null;
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

function mergeDifference(known: Difference, more: Difference): void {
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

export function consolidate(records: ProposedItem[]): Cluster[] {
  const clusters: Cluster[] = [];
  records.forEach((rec, i) => {
    const target = clusters.find((c) => matchRecords(c.proposed, rec)?.strength === "strong");
    if (!target) {
      clusters.push({ proposed: structuredClone(rec), sources: [i], differences: [] });
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
