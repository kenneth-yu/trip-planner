import { CONSENT_COOKIE, clearInviteCookieOptions, INVITE_COOKIE, InviteToken, inviteCookieOptions, redirectTo } from "../invite-cookies";

export async function GET(_request: Request, { params }: RouteContext<"/invite/[token]">) {
  const { token } = await params;
  const parsed = InviteToken.safeParse(token);
  if (!parsed.success) return redirectTo("/invite/problem/unusable");
  const response = redirectTo("/invite/join");
  response.cookies.set(INVITE_COOKIE, parsed.data, inviteCookieOptions);
  response.cookies.set(CONSENT_COOKIE, "", clearInviteCookieOptions);
  return response;
}
