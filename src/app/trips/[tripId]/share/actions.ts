"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { loadTripPage } from "@/server/web";
import { changeRole, createInvite, hiddenItemCount, removeMember, revokeInvite } from "@/server/services/sharing-service";
import { disableViewLink, enableViewLink, LinkRateLimited, rotateViewLink, setLinkShowsDeadlines, setViewersSeeDeadlines, spendLinkBudget } from "@/server/services/view-link-service";
import { AccessDenied } from "@/domain/visibility/project";
import { findCoTraveler, RateLimited, spendInviteBudget } from "@/server/services/member-service";
import { InputProblem } from "@/domain/import/quick-add";
import { firstName } from "@/domain/people/first-name";
import { InvalidTransition } from "@/domain/state/machine";

export interface CreatedInviteState {
  inviteId: string | null;
  travelerId: string | null;
  url: string | null;
  role: "editor" | "viewer" | null;
  forName: string | null;
  error: string | null;
}

const Ids = z.object({ tripId: z.string().uuid(), userId: z.string().uuid() });

const NEW_TRAVELER = "new";

export async function createInviteAction(_prev: CreatedInviteState, form: FormData): Promise<CreatedInviteState> {
  const tripId = z.string().uuid().parse(form.get("tripId"));
  const role = z.enum(["editor", "viewer"]).parse(form.get("role"));
  const traveler = z.string().parse(form.get("traveler") ?? NEW_TRAVELER);
  const personId = form.get("personId");
  const { ctx, requester, user } = await loadTripPage(tripId);
  try {
    await spendInviteBudget(ctx, user.id);
    const person = personId === null ? null : await findCoTraveler(ctx, tripId, requester, personId);
    const { inviteId, url } = await createInvite(ctx, tripId, requester, { role, travelerId: traveler === NEW_TRAVELER ? undefined : traveler });
    revalidatePath(`/trips/${tripId}/share`);
    return { inviteId, travelerId: traveler === NEW_TRAVELER ? null : traveler, url, role, forName: person ? firstName(person.name) : null, error: null };
  } catch (e) {
    if (e instanceof InputProblem || e instanceof RateLimited) return { inviteId: null, travelerId: null, url: null, role: null, forName: null, error: e.message };
    throw e;
  }
}

export async function revokeInviteAction(form: FormData): Promise<void> {
  const tripId = z.string().uuid().parse(form.get("tripId"));
  const inviteId = z.string().uuid().parse(form.get("inviteId"));
  const { ctx, requester } = await loadTripPage(tripId);
  try {
    await revokeInvite(ctx, tripId, requester, inviteId);
  } catch (e) {
    if (!(e instanceof InvalidTransition)) throw e;
  }
  revalidatePath(`/trips/${tripId}/share`);
}

export async function changeRoleAction(form: FormData): Promise<void> {
  const { tripId, userId } = Ids.parse({ tripId: form.get("tripId"), userId: form.get("userId") });
  const role = z.enum(["editor", "viewer"]).parse(form.get("role"));
  const { ctx, requester } = await loadTripPage(tripId);
  await changeRole(ctx, tripId, requester, userId, role);
  revalidatePath(`/trips/${tripId}/share`);
}

export async function previewRemoval(tripId: string, userId: string): Promise<number> {
  const ids = Ids.parse({ tripId, userId });
  const { ctx, requester } = await loadTripPage(ids.tripId);
  return hiddenItemCount(ctx, ids.tripId, requester, ids.userId);
}

export async function removeMemberAction(form: FormData): Promise<void> {
  const { tripId, userId } = Ids.parse({ tripId: form.get("tripId"), userId: form.get("userId") });
  const { ctx, requester } = await loadTripPage(tripId);
  await removeMember(ctx, tripId, requester, userId);
  revalidatePath(`/trips/${tripId}/share`);
}

export interface LinkRevealState {
  url: string | null;
  error: string | null;
}

export interface SwitchState {
  saved: boolean;
  error: string | null;
}

const TripOnly = z.object({ tripId: z.string().uuid() });
const SwitchForm = z.object({ tripId: z.string().uuid(), on: z.enum(["true", "false"]) });
const OWNER_ONLY = "Only the trip owner can change this.";

async function ownerAction<T>(form: FormData, work: (ctx: Awaited<ReturnType<typeof loadTripPage>>["ctx"], requester: Awaited<ReturnType<typeof loadTripPage>>["requester"], userId: string, tripId: string) => Promise<T>, onProblem: (message: string) => T): Promise<T> {
  const { tripId } = TripOnly.parse({ tripId: form.get("tripId") });
  const { ctx, requester, user } = await loadTripPage(tripId);
  try {
    const result = await work(ctx, requester, user.id, tripId);
    revalidatePath(`/trips/${tripId}/share`);
    return result;
  } catch (e) {
    if (e instanceof LinkRateLimited || e instanceof InvalidTransition) return onProblem(e instanceof LinkRateLimited ? e.message : "That already changed. Reload the page.");
    if (e instanceof AccessDenied) return onProblem(OWNER_ONLY);
    throw e;
  }
}

export async function enableLinkAction(_prev: LinkRevealState, form: FormData): Promise<LinkRevealState> {
  return ownerAction<LinkRevealState>(
    form,
    async (ctx, requester, userId, tripId) => {
      await spendLinkBudget(ctx, userId);
      return { url: (await enableViewLink(ctx, tripId, requester)).url, error: null };
    },
    (error) => ({ url: null, error }),
  );
}

export async function rotateLinkAction(_prev: LinkRevealState, form: FormData): Promise<LinkRevealState> {
  return ownerAction<LinkRevealState>(
    form,
    async (ctx, requester, userId, tripId) => {
      await spendLinkBudget(ctx, userId);
      return { url: (await rotateViewLink(ctx, tripId, requester)).url, error: null };
    },
    (error) => ({ url: null, error }),
  );
}

export async function disableLinkAction(_prev: SwitchState, form: FormData): Promise<SwitchState> {
  return ownerAction<SwitchState>(
    form,
    async (ctx, requester, _userId, tripId) => {
      await disableViewLink(ctx, tripId, requester);
      return { saved: true, error: null };
    },
    (error) => ({ saved: false, error }),
  );
}

export async function setLinkDeadlinesAction(_prev: SwitchState, form: FormData): Promise<SwitchState> {
  const { on } = SwitchForm.parse({ tripId: form.get("tripId"), on: form.get("on") });
  return ownerAction<SwitchState>(
    form,
    async (ctx, requester, _userId, tripId) => {
      await setLinkShowsDeadlines(ctx, tripId, requester, on === "true");
      return { saved: true, error: null };
    },
    (error) => ({ saved: false, error }),
  );
}

export async function setViewerDeadlinesAction(_prev: SwitchState, form: FormData): Promise<SwitchState> {
  const { on } = SwitchForm.parse({ tripId: form.get("tripId"), on: form.get("on") });
  return ownerAction<SwitchState>(
    form,
    async (ctx, requester, _userId, tripId) => {
      await setViewersSeeDeadlines(ctx, tripId, requester, on === "true");
      return { saved: true, error: null };
    },
    (error) => ({ saved: false, error }),
  );
}
