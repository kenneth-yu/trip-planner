"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { InputProblem } from "@/domain/import/problem";
import { GoogleAuthorizationError, googleCalendarReader } from "@/server/google/calendar-api";
import { importFromGoogle } from "@/server/google/import";
import { IMPORT_CLOSED, importIsRateLimited, importPagePath } from "@/server/google/import-guard";
import { IMPORT_COOKIE, openImportToken } from "@/server/google/import-oauth";
import { loadTripPage } from "@/server/web";

export interface ImportState {
  message: string | null;
  error: boolean;
}

const Form = z.object({ tripId: z.string().uuid(), from: z.string().max(10), to: z.string().max(10) });

export async function runGoogleImport(_previous: ImportState, form: FormData): Promise<ImportState> {
  const { tripId, from, to } = Form.parse({ tripId: form.get("tripId"), from: form.get("from"), to: form.get("to") });
  const path = importPagePath(tripId);
  if (!importIsRateLimited("POST", path)) return { message: IMPORT_CLOSED, error: true };
  const { ctx, user, requester } = await loadTripPage(tripId, path);
  const jar = await cookies();
  const token = openImportToken(jar.get(IMPORT_COOKIE)?.value, user.id, tripId);
  if (!token) return { message: "Connect Google Calendar again to import.", error: true };
  const calendarIds = form.getAll("calendar").filter((v): v is string => typeof v === "string");
  let events: number;
  try {
    events = (await importFromGoogle(ctx, googleCalendarReader(async () => token), tripId, requester, { calendarIds, from, to })).events;
  } catch (e) {
    if (e instanceof InputProblem) return { message: e.message, error: true };
    if (e instanceof GoogleAuthorizationError) {
      jar.delete({ name: IMPORT_COOKIE, path });
      return { message: "Google did not allow that. Connect Google Calendar again.", error: true };
    }
    throw e;
  }
  jar.delete({ name: IMPORT_COOKIE, path });
  revalidatePath(`/trips/${tripId}`, "layout");
  if (events === 0) return { message: "Nothing in those calendars for those dates.", error: false };
  redirect(`/trips/${tripId}/inbox`);
}
