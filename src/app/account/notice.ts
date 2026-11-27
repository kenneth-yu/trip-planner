import { z } from "zod";

export const NOTICE_COOKIE = "trip-notice";

const Notice = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("trip-deleted") }),
  z.object({ kind: z.literal("account-deleted") }),
]);

export type OneTimeNotice = z.infer<typeof Notice>;

export const noticeCookieOptions = {
  httpOnly: true,
  sameSite: "lax" as const,
  secure: process.env.NODE_ENV === "production",
  path: "/",
  maxAge: 60 * 10,
};

export function noticeValue(notice: OneTimeNotice): string {
  return JSON.stringify(notice);
}

export function noticeText(value: string | undefined): string | null {
  if (!value) return null;
  let raw: unknown;
  try {
    raw = JSON.parse(value);
  } catch (e) {
    if (e instanceof SyntaxError) return null;
    throw e;
  }
  const parsed = Notice.safeParse(raw);
  if (!parsed.success) return null;
  return parsed.data.kind === "trip-deleted" ? "Trip deleted." : "Your account is deleted.";
}
