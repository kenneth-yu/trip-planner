"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { InputProblem } from "@/domain/import/problem";
import { AccessDenied } from "@/domain/visibility/project";
import { createIdea, dropIdea, editIdea, markIdeaDone, markIdeaNotDone, restoreIdea, scheduleIdea } from "@/server/services/idea-service";
import { NotFound } from "@/server/services/trip-service";
import { loadTripPage } from "@/server/web";

export interface IdeaState {
  status: string | null;
  error: string | null;
  undo: { intent: "restore" | "notdone"; ideaId: string } | null;
}

const NOTHING: IdeaState = { status: null, error: null, undo: null };
const Ids = z.object({ tripId: z.string().uuid(), ideaId: z.string().min(1).max(64).optional() });
const Intent = z.enum(["add", "edit", "done", "notdone", "drop", "restore", "schedule"]);
const text = (form: FormData, name: string) => {
  const value = form.get(name);
  return typeof value === "string" && value.trim() !== "" ? value : undefined;
};

export async function ideaAction(_previous: IdeaState, form: FormData): Promise<IdeaState> {
  const { tripId, ideaId } = Ids.parse({ tripId: form.get("tripId"), ideaId: form.get("ideaId") ?? undefined });
  const intent = Intent.parse(form.get("intent"));
  const { ctx, requester } = await loadTripPage(tripId, `/trips/${tripId}/ideas`);
  const fields = { title: text(form, "title") ?? "", where: text(form, "where"), note: text(form, "note") };
  try {
    const id = ideaId ?? "";
    let state: IdeaState = NOTHING;
    if (intent === "add") {
      const idea = await createIdea(ctx, tripId, requester, fields);
      state = { ...NOTHING, status: idea.city ? `Added to ideas for ${idea.city}.` : "Added to ideas." };
    } else if (intent === "edit") {
      await editIdea(ctx, tripId, id, requester, fields);
      state = { ...NOTHING, status: "Saved." };
    } else if (intent === "done") {
      const idea = await markIdeaDone(ctx, tripId, id, requester);
      state = { status: `Marked ${idea.title} as done.`, error: null, undo: { intent: "notdone", ideaId: id } };
    } else if (intent === "notdone") {
      const idea = await markIdeaNotDone(ctx, tripId, id, requester);
      state = { ...NOTHING, status: `${idea.title} is back on the list.` };
    } else if (intent === "drop") {
      const idea = await dropIdea(ctx, tripId, id, requester);
      state = { status: `Dropped ${idea.title}.`, error: null, undo: { intent: "restore", ideaId: id } };
    } else if (intent === "restore") {
      const idea = await restoreIdea(ctx, tripId, id, requester);
      state = { ...NOTHING, status: `${idea.title} is back on the list.` };
    } else {
      const start = text(form, "start");
      const end = text(form, "end");
      const item = await scheduleIdea(ctx, tripId, id, requester, { type: "plan", title: fields.title, city: text(form, "city"), place: text(form, "place"), startLocal: start, endLocal: end, notes: fields.note });
      state = { ...NOTHING, status: `Scheduled ${item.title}.` };
    }
    revalidatePath(`/trips/${tripId}/ideas`);
    revalidatePath(`/trips/${tripId}`, "layout");
    return state;
  } catch (e) {
    if (e instanceof InputProblem || e instanceof AccessDenied || e instanceof NotFound) return { ...NOTHING, error: e.message };
    throw e;
  }
}
