"use server";

import { notFound, redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { loadTripPage } from "@/server/web";
import { NotFound, updateItem } from "@/server/services/trip-service";
import { placeContextFor } from "@/server/services/place-service";
import { RATE_RULES, consumeRateLimit } from "@/server/security/rate-limit";
import { editPatch, FORM_ERROR, MESSAGES, parseEditForm, parseTripId, placeQueryFor, type FormEntries, type ZoneOf } from "@/domain/import/item-form";
import { inputToProposal, InputProblem } from "@/domain/import/quick-add";
import { resolvePlace, type PlaceQuery } from "@/domain/time/resolve-place";
import { AccessDenied } from "@/domain/visibility/project";
import { setFlash } from "@/app/ui/item-form/set-flash";
import type { FormState } from "@/app/ui/item-form/form-state";
import { itemOf } from "../item-of";

const ItemId = z.string().uuid();
const SKIPPED = new Set(["tripId", "itemId", "type"]);

function entriesOf(form: FormData, type: string): FormEntries {
  const out: FormEntries = [["type", type]];
  for (const [key, value] of form.entries()) if (typeof value === "string" && !SKIPPED.has(key) && !key.startsWith("$ACTION")) out.push([key, value]);
  return out;
}

function placeQueriesIn(entries: FormEntries): PlaceQuery[] {
  const type = entries.find(([k]) => k === "type")?.[1];
  if (type === "flight") return [];
  const names = type === "transfer" ? ["from", "to"] : ["place"];
  return entries.filter(([k, v]) => names.includes(k) && v.trim()).map(([, v]) => placeQueryFor(v));
}

export async function editItem(_prev: FormState, form: FormData): Promise<FormState> {
  const tripId = parseTripId(form.get("tripId"));
  const parsedItemId = ItemId.safeParse(form.get("itemId"));
  if (!tripId || !parsedItemId.success) notFound();
  const itemId = parsedItemId.data;
  const { ctx, user, requester, view } = await loadTripPage(tripId);
  const item = itemOf(view, itemId);
  if (!item) return { errors: {}, message: null, values: [], gone: "deleted" };
  if (!view.permissions.canEdit) return { errors: {}, message: null, values: [], gone: "denied" };
  const entries = entriesOf(form, item.type);
  if (!(await consumeRateLimit(ctx.db, RATE_RULES.quickAdd, user.id, ctx.now())).allowed) return { errors: {}, message: MESSAGES.tooMany, values: entries };
  const places = await placeContextFor(ctx, view.items, requester.homeZone, placeQueriesIn(entries));
  const zoneOf: ZoneOf = (query, isoDate) => {
    const resolved = resolvePlace(query, { contextZone: places.zoneOnDate?.(isoDate) ?? null, geocoded: places.geocode?.(query) ?? null });
    return resolved.status === "unknown" ? null : resolved.zone;
  };
  const parsed = parseEditForm(entries, { travelerIds: item.travelerIds, previous: item.private, zoneOf });
  if (!parsed.ok) return { errors: parsed.errors, message: parsed.errors.form ?? null, values: entries };
  try {
    const proposal = inputToProposal({ ...parsed.input, travelers: item.travelerIds }, view.travelers, places, { draft: !parsed.booked, endEstimated: parsed.endEstimated });
    const patch = editPatch(item, proposal, parsed.private, parsed.booked);
    if (Object.keys(patch).length > 0) await updateItem(ctx, tripId, itemId, requester, patch);
  } catch (e) {
    if (e instanceof NotFound) return { errors: {}, message: null, values: entries, gone: "deleted" };
    if (e instanceof AccessDenied) return { errors: {}, message: null, values: entries, gone: "denied" };
    console.error("Edit failed", { tripId, error: e instanceof Error ? e.name : "unknown" });
    return { errors: {}, message: e instanceof InputProblem ? e.message : FORM_ERROR, values: entries };
  }
  await setFlash("saved", tripId);
  revalidatePath(`/trips/${tripId}`, "layout");
  redirect(`/trips/${tripId}/items/${itemId}`);
}
