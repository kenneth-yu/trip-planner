"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { requireUser } from "@/server/web";
import { requestContext } from "@/server/app-context";
import { createTrip } from "@/server/services/trip-service";

export interface NewTripState {
  error: string | null;
  name: string;
}

const TripName = z.string().trim().min(1, "Enter a trip name.").max(120, "Use 120 characters or fewer.");

export async function createTripAction(_prev: NewTripState, form: FormData): Promise<NewTripState> {
  const user = await requireUser();
  const raw = form.get("name");
  const name = typeof raw === "string" ? raw : "";
  const parsed = TripName.safeParse(name);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Enter a trip name.", name };
  const ctx = await requestContext();
  const tripId = await createTrip(ctx, { id: user.id, name: user.name }, parsed.data);
  redirect(`/trips/${tripId}`);
}
