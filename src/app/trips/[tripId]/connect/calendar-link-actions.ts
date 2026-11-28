"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { InvalidTransition } from "@/domain/state/machine";
import { FeedLinkExists, makeFeedLink, rotateFeedLink, turnOffFeedLink } from "@/server/services/feed-service";
import { LinkRateLimited, spendLinkBudget } from "@/server/services/view-link-service";
import { loadTripPage } from "@/server/web";

import type { CalendarLinkState } from "./calendar-link-text";

export async function calendarLinkAction(_previous: CalendarLinkState, form: FormData): Promise<CalendarLinkState> {
  const tripId = z.string().uuid().parse(form.get("tripId"));
  const intent = z.enum(["make", "rotate", "off"]).parse(form.get("intent"));
  const { ctx, requester, user } = await loadTripPage(tripId);
  try {
    await spendLinkBudget(ctx, user.id);
    if (intent === "off") {
      await turnOffFeedLink(ctx, tripId, requester);
      revalidatePath(`/trips/${tripId}/connect`);
      return { url: null, turnedOff: true, error: null };
    }
    const { url } = intent === "make" ? await makeFeedLink(ctx, tripId, requester) : await rotateFeedLink(ctx, tripId, requester);
    revalidatePath(`/trips/${tripId}/connect`);
    return { url, turnedOff: false, error: null };
  } catch (e) {
    if (e instanceof LinkRateLimited) return { url: null, turnedOff: false, error: e.message };
    if (e instanceof FeedLinkExists || e instanceof InvalidTransition) return { url: null, turnedOff: false, error: "That already changed. Reload the page." };
    throw e;
  }
}
