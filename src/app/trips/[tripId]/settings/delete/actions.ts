"use server";

import { cookies } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { z } from "zod";
import { loadTripPage } from "@/server/web";
import { GoogleApiError } from "@/server/google/calendar-api";
import { deleteTrip } from "@/server/services/deletion-service";
import { AccessDenied } from "@/domain/visibility/project";
import { confirmationMatches } from "../../../../account/confirm";
import { NOTICE_COOKIE, noticeCookieOptions, noticeValue } from "../../../../account/notice";

export interface DeleteTripState {
  status: "idle" | "mismatch" | "google" | "failed";
}

const Input = z.object({ tripId: z.string().uuid(), confirm: z.string().max(500) });

export async function deleteTripAction(_prev: DeleteTripState, form: FormData): Promise<DeleteTripState> {
  const parsed = Input.safeParse({ tripId: form.get("tripId"), confirm: form.get("confirm") ?? "" });
  if (!parsed.success) notFound();
  const { tripId, confirm } = parsed.data;
  const { ctx, requester, view } = await loadTripPage(tripId);
  if (view.permissions.role !== "owner") notFound();
  if (!confirmationMatches(confirm, view.trip.name)) return { status: "mismatch" };
  try {
    await deleteTrip(ctx, tripId, requester);
  } catch (e) {
    if (e instanceof AccessDenied) notFound();
    if (e instanceof GoogleApiError) return { status: "google" };
    console.error(`Trip ${tripId} was not deleted: ${e instanceof Error ? e.name : "unknown error"}`);
    return { status: "failed" };
  }
  (await cookies()).set(NOTICE_COOKIE, noticeValue({ kind: "trip-deleted" }), noticeCookieOptions);
  redirect("/");
}
