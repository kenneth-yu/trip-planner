import { z } from "zod";
import { airportByCode } from "@/domain/time/places";
import type { ProposedItem } from "@/domain/import/proposal";
import type { AddAllResult, DecidedEntry } from "@/server/services/inbox-service";

export type Tapped = "add" | "merge" | "discard";
export type Role = "status" | "alert";

export interface Outcome {
  text: string;
  role: Role;
}

export function entryLabel(p: Pick<ProposedItem, "type" | "title" | "flight">): string {
  if (p.type !== "flight" || !p.flight) return p.title;
  const city = airportByCode(p.flight.toAirport)?.city;
  return city ? `${p.title} to ${city}` : p.title;
}

export function decidedOutcome(tapped: Tapped, entry: DecidedEntry): Outcome {
  const who = entry.by ?? "Someone on the trip";
  const label = entryLabel(entry.proposed);
  const { state } = entry;
  if (tapped === "discard") {
    if (state === "discarded") return { text: `${who} already discarded ${label}.`, role: "status" };
    return { text: `${who} already added ${label}. To remove it, open it on the trip and delete it.`, role: "alert" };
  }
  if (state === "discarded") return { text: `${who} discarded ${label}, so it was not added. Add it again from its source if you need it.`, role: "alert" };
  if (tapped === "add") {
    if (state === "approved") return { text: `${who} already added ${label}.`, role: "status" };
    return {
      text: entry.intoVisible ? `${who} merged ${label} into an item already on the trip, so it was not added twice.` : `${who} merged ${label}, so it was not added twice.`,
      role: "status",
    };
  }
  return state === "merged"
    ? { text: `${who} already merged ${label}.`, role: "status" }
    : { text: `${who} added ${label} as its own item, so nothing was merged. Check the trip for a duplicate.`, role: "alert" };
}

export function addedOutcome(p: Pick<ProposedItem, "type" | "title" | "flight">): Outcome {
  return { text: `Added ${entryLabel(p)}.`, role: "status" };
}

export function mergedOutcome(p: Pick<ProposedItem, "type" | "title" | "flight">, intoTitle: string): Outcome {
  return { text: `Merged ${entryLabel(p)} into ${intoTitle}.`, role: "status" };
}

export function discardedOutcome(p: Pick<ProposedItem, "type" | "title" | "flight">): Outcome {
  return { text: `Discarded ${entryLabel(p)}.`, role: "status" };
}

export const ENTRY_GONE: Outcome = { text: "That item is no longer in the inbox.", role: "status" };

export function savedWithoutRemovedTraveler(p: Pick<ProposedItem, "type" | "title" | "flight">, intoTitle: string | null): Outcome {
  const text = intoTitle === null ? `Added ${entryLabel(p)} without the removed traveler.` : `Merged ${entryLabel(p)} into ${intoTitle} without the removed traveler.`;
  return { text, role: "status" };
}

export function addAllText(r: AddAllResult): string {
  const decided = r.alreadyDecided + r.alreadyByYou;
  if (r.added === 0 && r.needYou === 0 && decided > 0) return r.alreadyByYou === 0 ? "These were already decided by someone else." : "These were already decided.";
  const parts: string[] = [];
  const be = (n: number) => (n === 1 ? "was" : "were");
  if (r.added > 0) parts.push(`Added ${r.added}.`);
  if (r.alreadyDecided > 0) parts.push(`${r.alreadyDecided} ${be(r.alreadyDecided)} already decided by someone else.`);
  if (r.alreadyByYou > 0) parts.push(`${r.alreadyByYou} ${be(r.alreadyByYou)} already decided.`);
  if (r.withoutRemovedTraveler > 0) parts.push(`${r.withoutRemovedTraveler} ${be(r.withoutRemovedTraveler)} saved without a removed traveler.`);
  if (r.needYou > 0) parts.push(`${r.needYou} still ${r.needYou === 1 ? "needs" : "need"} you: see below.`);
  return parts.join(" ");
}

const Count = z.coerce.number().int().min(0).max(100_000);

export function importedOutcome(imported: unknown, matched: unknown): Outcome | null {
  const waiting = Count.safeParse(imported);
  if (!waiting.success) return null;
  const same = Count.safeParse(matched);
  const first = `${waiting.data} ${waiting.data === 1 ? "event is" : "events are"} waiting in your inbox.`;
  const count = same.success ? same.data : 0;
  if (count === 0) return { text: first, role: "status" };
  return { text: `${first} ${count} ${count === 1 ? "looks like a thing" : "look like things"} already on the trip.`, role: "status" };
}
