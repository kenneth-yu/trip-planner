"use server";

import { notFound, redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { loadTripPage } from "@/server/web";
import { NotFound, removeItem } from "@/server/services/trip-service";
import { parseTripId } from "@/domain/import/item-form";
import { localDateKey } from "@/domain/time/format";
import { AccessDenied } from "@/domain/visibility/project";
import { setFlash } from "@/app/ui/item-form/set-flash";
import { itemOf } from "./item-of";

const ItemId = z.string().uuid();

export interface DeleteState {
  failed: boolean;
}

export async function deleteItem(_prev: DeleteState, form: FormData): Promise<DeleteState> {
  const tripId = parseTripId(form.get("tripId"));
  const parsedItemId = ItemId.safeParse(form.get("itemId"));
  if (!tripId || !parsedItemId.success) notFound();
  const itemId = parsedItemId.data;
  const { ctx, requester, view } = await loadTripPage(tripId);
  const item = itemOf(view, itemId);
  if (!item) redirect(`/trips/${tripId}`);
  const day = localDateKey(item.start);
  try {
    await removeItem(ctx, tripId, itemId, requester);
  } catch (e) {
    if (e instanceof NotFound) redirect(`/trips/${tripId}`);
    if (e instanceof AccessDenied) return { failed: true };
    console.error("Delete failed", { tripId, error: e instanceof Error ? e.name : "unknown" });
    return { failed: true };
  }
  await setFlash("deleted", tripId);
  revalidatePath(`/trips/${tripId}`, "layout");
  redirect(`/trips/${tripId}?day=${day}`);
}
