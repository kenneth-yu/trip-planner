"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { loadTripPage } from "@/server/web";
import { approveAllClean, approveEntry, decidedEntry, discardEntry, EntryGone, mergeEntry, NeedsDecision, type Saved } from "@/server/services/inbox-service";
import { addAllText, addedOutcome, decidedOutcome, discardedOutcome, ENTRY_GONE, mergedOutcome, savedWithoutRemovedTraveler, type Outcome } from "./inbox/messages";
import { createAssistantToken, revokeAssistantToken } from "@/server/services/assistant-service";
import { disableMirror, syncMirror } from "@/server/services/mirror-service";
import { appUrl } from "@/server/app-context";
import type { Choices } from "@/domain/import/matching";
import { InvalidTransition } from "@/domain/state/machine";

export interface ActionState {
  message: string | null;
  error: boolean;
}

const FIELDS = ["start", "end", "fromAirport", "toAirport"] as const;

function choicesFrom(form: FormData, prefix: string): Choices {
  const out: Choices = {};
  for (const f of FIELDS) {
    const v = form.get(`${prefix}${f}`);
    if (typeof v === "string" && v !== "") out[f] = Number(v);
  }
  return out;
}

const Decide = z.object({ tripId: z.string().uuid(), entryId: z.string().uuid(), action: z.enum(["add", "merge", "discard"]) });

export type DecideResult = { kind: "needs_choice"; message: string } | { kind: "done"; outcome: Outcome };

function savedOutcome(saved: Saved, action: "add" | "merge"): Outcome {
  if (saved.withoutRemovedTraveler) return savedWithoutRemovedTraveler(saved.proposed);
  return action === "merge" && saved.intoTitle !== null ? mergedOutcome(saved.proposed, saved.intoTitle) : addedOutcome(saved.proposed);
}

export async function decideEntry(form: FormData): Promise<DecideResult> {
  const { tripId, entryId, action } = Decide.parse(Object.fromEntries(form));
  const { ctx, requester } = await loadTripPage(tripId);
  try {
    let outcome: Outcome;
    if (action === "discard") outcome = discardedOutcome(await discardEntry(ctx, tripId, entryId, requester));
    else if (action === "merge") outcome = savedOutcome(await mergeEntry(ctx, tripId, entryId, requester, { choices: choicesFrom(form, "choice:"), keep: choicesFrom(form, "keep:") }), "merge");
    else outcome = savedOutcome(await approveEntry(ctx, tripId, entryId, requester, { choices: choicesFrom(form, "choice:") }), "add");
    revalidatePath(`/trips/${tripId}`, "layout");
    return { kind: "done", outcome };
  } catch (e) {
    if (e instanceof NeedsDecision) return { kind: "needs_choice", message: e.message };
    if (e instanceof EntryGone) {
      revalidatePath(`/trips/${tripId}`, "layout");
      return { kind: "done", outcome: ENTRY_GONE };
    }
    if (!(e instanceof InvalidTransition)) throw e;
    const decided = await decidedEntry(ctx, tripId, entryId, requester);
    if (!decided) throw e;
    revalidatePath(`/trips/${tripId}`, "layout");
    return { kind: "done", outcome: decidedOutcome(action, decided) };
  }
}

export async function addAllClean(form: FormData): Promise<{ text: string }> {
  const tripId = z.string().uuid().parse(form.get("tripId"));
  const { ctx, requester } = await loadTripPage(tripId);
  const result = await approveAllClean(ctx, tripId, requester);
  revalidatePath(`/trips/${tripId}`, "layout");
  return { text: addAllText(result) };
}

export interface TokenState {
  url: string | null;
}

export async function connectAssistant(_prev: TokenState, form: FormData): Promise<TokenState> {
  const tripId = z.string().uuid().parse(form.get("tripId"));
  const label = z.string().trim().min(1).max(80).catch("Assistant").parse(form.get("label"));
  const { ctx, user, view } = await loadTripPage(tripId);
  const scope = form.get("scope") === "read" || !view.permissions.canEdit ? "read" : "propose";
  const { token } = await createAssistantToken(ctx, user.id, { label, tripId, scope });
  revalidatePath(`/trips/${tripId}/connect`);
  return { url: `${appUrl()}/api/mcp/${token}` };
}

export async function revokeAssistant(form: FormData) {
  const tripId = z.string().uuid().parse(form.get("tripId"));
  const tokenId = z.string().uuid().parse(form.get("tokenId"));
  const { ctx, user } = await loadTripPage(tripId);
  try {
    await revokeAssistantToken(ctx, user.id, tokenId);
  } catch (e) {
    if (!(e instanceof InvalidTransition)) throw e;
  }
  revalidatePath(`/trips/${tripId}/connect`);
}

export async function mirrorAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  const tripId = z.string().uuid().parse(form.get("tripId"));
  const action = z.enum(["sync", "off", "connect"]).parse(form.get("action"));
  const { ctx, user } = await loadTripPage(tripId);
  if (action === "connect") redirect(`/api/google/connect?trip=${tripId}`);
  if (action === "off") await disableMirror(ctx, tripId, user.id);
  let state: ActionState = { message: null, error: false };
  if (action === "sync") {
    try {
      const r = await syncMirror(ctx, tripId, user.id);
      state = { message: `Up to date. ${r.created} added, ${r.updated} changed, ${r.deleted} removed.`, error: false };
    } catch (e) {
      state = { message: e instanceof Error ? e.message : String(e), error: true };
    }
  }
  revalidatePath(`/trips/${tripId}/connect`);
  return state;
}
