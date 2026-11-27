import { INVITE_COOKIE, InviteToken, inviteCookieOptions, redirectTo } from "../invite-cookies";

export async function GET(_request: Request, { params }: RouteContext<"/invite/[token]">) {
  const { token } = await params;
  const parsed = InviteToken.safeParse(token);
  if (!parsed.success) return redirectTo("/invite/problem/unusable");
  const response = redirectTo("/invite/accept");
  response.cookies.set(INVITE_COOKIE, parsed.data, inviteCookieOptions);
  return response;
}
