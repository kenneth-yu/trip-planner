import { NextResponse } from "next/server";
import { z } from "zod";
import { hashToken } from "@/server/auth/tokens";

export const INVITE_COOKIE = "trip-invite";
export const CONSENT_COOKIE = "trip-invite-ok";
export const NOTICE_COOKIE = "trip-joined";

const INVITE_MAX_AGE_SECONDS = 60 * 60;
const NOTICE_MAX_AGE_SECONDS = 60 * 10;

export const InviteToken = z.string().regex(/^tpi_[A-Za-z0-9_-]{20,100}$/);

function baseOptions(path: string, maxAge: number) {
  return { httpOnly: true, sameSite: "lax" as const, secure: process.env.NODE_ENV === "production", path, maxAge };
}

export const inviteCookieOptions = baseOptions("/invite", INVITE_MAX_AGE_SECONDS);
export const noticeCookieOptions = baseOptions("/", NOTICE_MAX_AGE_SECONDS);
export const clearInviteCookieOptions = { ...inviteCookieOptions, maxAge: 0 };
export const consentCookieOptions = inviteCookieOptions;
export const clearNoticeCookieOptions = { ...noticeCookieOptions, maxAge: 0 };

export function redirectTo(path: string): NextResponse {
  return new NextResponse(null, { status: 303, headers: { location: path } });
}

export function inviteTokenFrom(value: string | undefined): string | null {
  const parsed = InviteToken.safeParse(value);
  return parsed.success ? parsed.data : null;
}

export function consentFor(token: string): string {
  return hashToken(token);
}
