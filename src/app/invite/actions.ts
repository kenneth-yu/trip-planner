"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { signInPath } from "@/domain/auth/next-path";
import { currentUser } from "@/server/auth/session";
import { requestContext } from "@/server/app-context";
import { claimInvite } from "./claim";
import {
  CONSENT_COOKIE,
  consentFor,
  inviteTokenFrom,
  clearInviteCookieOptions,
  consentCookieOptions,
  INVITE_COOKIE,
  NOTICE_COOKIE,
  noticeCookieOptions,
} from "./invite-cookies";

export async function continueToSignIn(): Promise<void> {
  const jar = await cookies();
  const token = inviteTokenFrom(jar.get(INVITE_COOKIE)?.value);
  if (!token) redirect("/invite/lost");
  jar.set(CONSENT_COOKIE, consentFor(token), consentCookieOptions);
  redirect(signInPath("/invite/accept"));
}

export async function joinTrip(): Promise<void> {
  const jar = await cookies();
  const token = inviteTokenFrom(jar.get(INVITE_COOKIE)?.value);
  if (!token) redirect("/invite/lost");
  const user = await currentUser();
  if (!user) redirect("/invite/join");
  const claim = await claimInvite(await requestContext(), token, { id: user.id, name: user.name });
  jar.set(INVITE_COOKIE, "", clearInviteCookieOptions);
  jar.set(CONSENT_COOKIE, "", clearInviteCookieOptions);
  if (claim.notice) jar.set(NOTICE_COOKIE, claim.notice, noticeCookieOptions);
  redirect(claim.path);
}
