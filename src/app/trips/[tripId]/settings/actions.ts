"use server";

import { notFound } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireUser } from "@/server/web";
import { requestContext } from "@/server/app-context";
import { RATE_RULES, consumeRateLimit } from "@/server/security/rate-limit";
import { NotFound } from "@/server/services/trip-service";
import { addTraveler, linkTraveler, removeTraveler, renameTraveler, renameTrip } from "@/server/services/traveler-service";
import { InputProblem } from "@/domain/import/quick-add";
import { removalRefusal, type RefusalSegment } from "@/domain/travelers/removal";
import { AccessDenied } from "@/domain/visibility/project";
import type { Requester } from "@/domain/types";

export type SettingsResult =
  | { ok: true; id: string | null; name: string | null }
  | { ok: false; error: string; refusal: RefusalSegment[] | null };

const TRY_AGAIN = "That did not save. Try again.";
const TOO_MANY = "Too many changes just now. Wait a minute and try again.";
const Id = z.string().uuid();

function failure(error: string, refusal: RefusalSegment[] | null = null): SettingsResult {
  return { ok: false, error, refusal };
}

async function context(form: FormData) {
  const tripId = Id.safeParse(form.get("tripId"));
  if (!tripId.success) notFound();
  const user = await requireUser(`/trips/${tripId.data}/settings`);
  const ctx = await requestContext();
  const requester: Requester = { kind: "member", userId: user.id, homeZone: user.homeZone };
  return { tripId: tripId.data, user, ctx, requester };
}

function idOf(form: FormData, key: string): string {
  const parsed = Id.safeParse(form.get(key));
  if (!parsed.success) notFound();
  return parsed.data;
}

async function guarded(tripId: string, run: () => Promise<SettingsResult>): Promise<SettingsResult> {
  try {
    const result = await run();
    revalidatePath(`/trips/${tripId}`, "layout");
    return result;
  } catch (e) {
    if (e instanceof NotFound) notFound();
    if (e instanceof InputProblem || e instanceof AccessDenied) return failure(e.message);
    console.error("Settings change failed", { tripId, error: e instanceof Error ? e.name : "unknown" });
    return failure(TRY_AGAIN);
  }
}

export async function renameTripAction(form: FormData): Promise<SettingsResult> {
  const { tripId, ctx, requester } = await context(form);
  return guarded(tripId, async () => ({ ok: true, id: null, name: (await renameTrip(ctx, tripId, requester, form.get("name"))).name }));
}

export async function addTravelerAction(form: FormData): Promise<SettingsResult> {
  const { tripId, user, ctx, requester } = await context(form);
  return guarded(tripId, async () => {
    if (!(await consumeRateLimit(ctx.db, RATE_RULES.travelerAdd, user.id, ctx.now())).allowed) return failure(TOO_MANY);
    const created = await addTraveler(ctx, tripId, requester, form.get("name"));
    return { ok: true, id: created.id, name: created.name };
  });
}

export async function renameTravelerAction(form: FormData): Promise<SettingsResult> {
  const { tripId, ctx, requester } = await context(form);
  const travelerId = idOf(form, "travelerId");
  return guarded(tripId, async () => {
    await renameTraveler(ctx, tripId, requester, travelerId, form.get("name"));
    return { ok: true, id: travelerId, name: null };
  });
}

export async function linkTravelerAction(form: FormData): Promise<SettingsResult> {
  const { tripId, ctx, requester } = await context(form);
  const travelerId = idOf(form, "travelerId");
  const userId = Id.safeParse(form.get("userId"));
  if (!userId.success) return failure("Pick someone from the list.");
  return guarded(tripId, async () => {
    await linkTraveler(ctx, tripId, requester, travelerId, userId.data);
    return { ok: true, id: travelerId, name: null };
  });
}

export async function removeTravelerAction(form: FormData): Promise<SettingsResult> {
  const { tripId, ctx, requester } = await context(form);
  const travelerId = idOf(form, "travelerId");
  return guarded(tripId, async () => {
    const outcome = await removeTraveler(ctx, tripId, requester, travelerId);
    if (outcome.status === "refused") return failure("refused", removalRefusal(outcome.name, outcome.visible));
    return { ok: true, id: travelerId, name: outcome.status === "removed" ? outcome.name : null };
  });
}
