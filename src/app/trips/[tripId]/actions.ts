"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { loadTripPage } from "@/server/web";
import { approveAllClean, approveEntry, discardEntry, mergeEntry, NeedsDecision } from "@/server/services/inbox-service";
import { createAssistantToken, revokeAssistantToken } from "@/server/services/assistant-service";
import { disableMirror, syncMirror } from "@/server/services/mirror-service";
import { appUrl } from "@/server/app-context";
import type { Choices } from "@/domain/import/matching";
import { UnknownTraveler } from "@/server/repo/trip-repo";
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

export async function decideEntry(_prev: ActionState, form: FormData): Promise<ActionState> {
  const { tripId, entryId, action } = Decide.parse(Object.fromEntries(form));
  const { ctx, requester } = await loadTripPage(tripId);
  try {
    if (action === "add") await approveEntry(ctx, tripId, entryId, requester, { choices: choicesFrom(form, "choice:") });
    if (action === "merge") await mergeEntry(ctx, tripId, entryId, requester, { choices: choicesFrom(form, "choice:"), keep: choicesFrom(form, "keep:") });
    if (action === "discard") await discardEntry(ctx, tripId, entryId, requester);
  } catch (e) {
    if (e instanceof NeedsDecision || e instanceof UnknownTraveler) return { message: e.message, error: true };
    throw e;
  }
  revalidatePath(`/trips/${tripId}`, "layout");
  return { message: null, error: false };
}

export async function addAllClean(form: FormData) {
  const tripId = z.string().uuid().parse(form.get("tripId"));
  const { ctx, requester } = await loadTripPage(tripId);
  await approveAllClean(ctx, tripId, requester);
  revalidatePath(`/trips/${tripId}`, "layout");
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
