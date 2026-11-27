import type { NextRequest } from "next/server";
import { currentUser } from "@/server/auth/session";
import { requestContext } from "@/server/app-context";
import { claimInvite } from "../claim";
import {
  CONSENT_COOKIE,
  clearInviteCookieOptions,
  INVITE_COOKIE,
  NOTICE_COOKIE,
  noticeCookieOptions,
  redirectTo,
} from "../invite-cookies";

export async function GET(request: NextRequest) {
  const token = request.cookies.get(INVITE_COOKIE)?.value;
  if (!token) return redirectTo("/invite/lost");
  const user = await currentUser();
  if (!user || request.cookies.get(CONSENT_COOKIE)?.value !== "1") return redirectTo("/invite/join");
  const claim = await claimInvite(await requestContext(), token, { id: user.id, name: user.name });
  const response = redirectTo(claim.path);
  response.cookies.set(INVITE_COOKIE, "", clearInviteCookieOptions);
  response.cookies.set(CONSENT_COOKIE, "", clearInviteCookieOptions);
  if (claim.notice) response.cookies.set(NOTICE_COOKIE, claim.notice, noticeCookieOptions);
  return response;
}
