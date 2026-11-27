"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { loadTripPage } from "@/server/web";
import { changeRole, createInvite, hiddenItemCount, removeMember, revokeInvite } from "@/server/services/sharing-service";
import { findCoTraveler, RateLimited, spendInviteBudget } from "@/server/services/member-service";
import { InputProblem } from "@/domain/import/quick-add";
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
    return { inviteId, travelerId: traveler === NEW_TRAVELER ? null : traveler, url, role, forName: person ? person.name.split(" ")[0] : null, error: null };
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
