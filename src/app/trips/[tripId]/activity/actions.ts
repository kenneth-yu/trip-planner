"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { loadTripPage } from "@/server/web";
import { undoActivity, UndoRefused } from "@/server/services/activity-service";
import { AccessDenied } from "@/domain/visibility/project";
import { DateTime } from "@/domain/time/luxon";
import { formatDayHeader } from "@/domain/time/format";
import type { UndoState } from "./undo-state";

const Form = z.object({ tripId: z.string().uuid(), activityId: z.string().min(1).max(64) });

export async function undoAction(_prev: UndoState, form: FormData): Promise<UndoState> {
  const { tripId, activityId } = Form.parse({ tripId: form.get("tripId"), activityId: form.get("activityId") });
  const { ctx, requester } = await loadTripPage(tripId);
  try {
    const done = await undoActivity(ctx, tripId, requester, activityId);
    revalidatePath(`/trips/${tripId}/activity`);
    const owner = done.by === "You" ? "your" : `${done.by}'s`;
    if (done.kind === "deleted" && done.dayKey) {
      return { parts: [{ text: `${done.title} is back on ` }, { text: formatDayHeader(DateTime.fromISO(done.dayKey)), href: `/trips/${tripId}?day=${done.dayKey}` }, { text: "." }] };
    }
    if (done.kind === "created") return { parts: [{ text: `Removed ${done.title}.` }] };
    if (done.kind === "merged") return { parts: [{ text: `${done.title} is back to how it was before the merge.` }] };
    if (done.kind === "undone") return { parts: [{ text: `${done.title} is back to how it was before the undo.` }] };
    return { parts: [{ text: `${done.title} is back to how it was before ${owner} change.` }] };
  } catch (e) {
    if (e instanceof UndoRefused) {
      revalidatePath(`/trips/${tripId}/activity`);
      if (e.reason !== "changed") return { parts: [{ text: e.message }] };
      const link = e.itemId ? [{ text: e.title, href: `/trips/${tripId}/items/${e.itemId}` }] : [{ text: e.title }];
      return { parts: [...link, { text: " changed again since then, so nothing was undone. Open it to change it by hand." }] };
    }
    if (e instanceof AccessDenied) return { parts: [{ text: "You can no longer change this item." }] };
    throw e;
  }
}
