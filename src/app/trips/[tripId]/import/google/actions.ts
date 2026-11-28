"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { DateTime } from "@/domain/time/luxon";
import { z } from "zod";
import { formatShortDate } from "@/domain/time/format";
import { InputProblem } from "@/domain/import/problem";
import { GoogleApiError, GoogleAuthorizationError } from "@/server/google/calendar-api";
import { importFromGoogle } from "@/server/google/import";
import { IMPORT_CLOSED, importIsRateLimited, importPagePath, importReader } from "@/server/google/import-guard";
import { IMPORT_COOKIE, IMPORT_SEEN_COOKIE, openImportToken } from "@/server/google/import-oauth";
import { loadTripPage } from "@/server/web";

export interface ImportState {
  message: string | null;
  error: boolean;
}

const EXPIRED = "That took a while, so Google's permission ran out. Continue to Google again.";
const TIMEOUT = "Google did not answer. Try again in a few minutes.";
const shortDate = (iso: string) => formatShortDate(DateTime.fromISO(iso, { zone: "utc" }));

const Form = z.object({ tripId: z.string().uuid(), from: z.string().max(10), to: z.string().max(10) });

export async function runGoogleImport(_previous: ImportState, form: FormData): Promise<ImportState> {
  const { tripId, from, to } = Form.parse({ tripId: form.get("tripId"), from: form.get("from"), to: form.get("to") });
  const path = importPagePath(tripId);
  if (!importIsRateLimited("POST", path)) return { message: IMPORT_CLOSED, error: true };
  const { ctx, user, requester } = await loadTripPage(tripId, path);
  const jar = await cookies();
  const token = openImportToken(jar.get(IMPORT_COOKIE)?.value, user.id, tripId);
  if (!token) return { message: EXPIRED, error: true };
  const calendarIds = form.getAll("calendar").filter((v): v is string => typeof v === "string");
  let imported: { events: number; waiting: number; matched: number };
  try {
    imported = (await importFromGoogle(ctx, await importReader(token), tripId, requester, { calendarIds, from, to }));
  } catch (e) {
    if (e instanceof InputProblem) return { message: e.message, error: true };
    if (e instanceof GoogleAuthorizationError) {
      jar.delete({ name: IMPORT_COOKIE, path });
      return { message: "Google did not allow that. Continue to Google again.", error: true };
    }
    if (e instanceof GoogleApiError) return { message: TIMEOUT, error: true };
    throw e;
  }
  jar.delete({ name: IMPORT_COOKIE, path });
  jar.delete({ name: IMPORT_SEEN_COOKIE, path });
  revalidatePath(`/trips/${tripId}`, "layout");
  if (imported.events === 0) return { message: `Nothing in those calendars falls between ${shortDate(from)} and ${shortDate(to)}. Change the dates or choose other calendars.`, error: false };
  redirect(`/trips/${tripId}/inbox?imported=${imported.waiting}&matched=${imported.matched}`);
}
