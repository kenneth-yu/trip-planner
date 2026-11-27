"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";
import { currentUser } from "@/server/auth/session";
import { sessionCookieName } from "@/server/auth/config";
import { requestContext } from "@/server/app-context";
import { GoogleApiError } from "@/server/google/calendar-api";
import { deleteAccount } from "@/server/services/deletion-service";
import { NotFound } from "@/server/services/trip-service";
import { confirmationMatches } from "./confirm";
import { NOTICE_COOKIE, noticeCookieOptions, noticeValue } from "./notice";

export interface DeleteAccountState {
  status: "idle" | "mismatch" | "blocked" | "google" | "failed";
  blockedBy: { tripId: string; name: string }[];
}

const Input = z.object({ confirm: z.string().max(100), shared: z.enum(["give", "delete"]) });

export async function deleteAccountAction(_prev: DeleteAccountState, form: FormData): Promise<DeleteAccountState> {
  const user = await currentUser();
  if (!user) redirect("/sign-in");
  const parsed = Input.safeParse({ confirm: form.get("confirm") ?? "", shared: form.get("shared") ?? "give" });
  if (!parsed.success || !confirmationMatches(parsed.data.confirm, "delete")) return { status: "mismatch", blockedBy: [] };
  const ctx = await requestContext();
  try {
    const result = await deleteAccount(ctx, user.id, { removeHiddenItemsInSharedTrips: parsed.data.shared === "delete" });
    if (result.blockedBy.length > 0) return { status: "blocked", blockedBy: result.blockedBy };
  } catch (e) {
    if (e instanceof NotFound) redirect("/");
    if (e instanceof GoogleApiError) return { status: "google", blockedBy: [] };
    console.error(`Account ${user.id} was not deleted: ${e instanceof Error ? e.name : "unknown error"}`);
    return { status: "failed", blockedBy: [] };
  }
  const jar = await cookies();
  jar.delete(sessionCookieName(process.env));
  jar.set(NOTICE_COOKIE, noticeValue({ kind: "account-deleted" }), noticeCookieOptions);
  redirect("/");
}
