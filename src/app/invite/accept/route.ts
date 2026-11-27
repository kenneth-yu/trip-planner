import type { NextRequest } from "next/server";
import { currentUser } from "@/server/auth/session";
import { requestContext } from "@/server/app-context";
import { acceptInvite, InviteProblem } from "@/server/services/sharing-service";
import {
  clearInviteCookieOptions,
  INVITE_COOKIE,
  NOTICE_COOKIE,
  noticeCookieOptions,
  redirectTo,
} from "../invite-cookies";
import { noticeValue } from "../notice";

export async function GET(request: NextRequest) {
  const token = request.cookies.get(INVITE_COOKIE)?.value;
  if (!token) return redirectTo("/invite/lost");
  const user = await currentUser();
  if (!user) return redirectTo("/invite/join");
  const ctx = await requestContext();
  try {
    const accepted = await acceptInvite(ctx, token, { id: user.id, name: user.name });
    const response = redirectTo(`/trips/${accepted.tripId}`);
    response.cookies.set(INVITE_COOKIE, "", clearInviteCookieOptions);
    response.cookies.set(NOTICE_COOKIE, noticeValue(accepted), noticeCookieOptions);
    return response;
  } catch (e) {
    if (!(e instanceof InviteProblem)) throw e;
    const response = redirectTo(`/invite/problem/${e.problem}`);
    response.cookies.set(INVITE_COOKIE, "", clearInviteCookieOptions);
    return response;
  }
}
