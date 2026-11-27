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
    return state === "approved"
      ? { text: `${who} already added ${label}.`, role: "status" }
      : { text: `${who} merged ${label} into an item already on the trip, so it was not added twice.`, role: "status" };
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

export function savedWithoutRemovedTraveler(p: Pick<ProposedItem, "type" | "title" | "flight">): Outcome {
  return { text: `Added ${entryLabel(p)} without the removed traveler.`, role: "status" };
}

export function addAllText(r: AddAllResult): string {
  if (r.added === 0 && r.needYou === 0 && r.alreadyDecided > 0) return "These were already decided by someone else.";
  const parts: string[] = [];
  if (r.added > 0) parts.push(`Added ${r.added}.`);
  if (r.alreadyDecided > 0) parts.push(`${r.alreadyDecided} ${r.alreadyDecided === 1 ? "was" : "were"} already decided by someone else.`);
  if (r.needYou > 0) parts.push(`${r.needYou} still ${r.needYou === 1 ? "needs" : "need"} you: see below.`);
  return parts.join(" ");
}
