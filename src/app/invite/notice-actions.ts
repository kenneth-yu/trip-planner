"use server";

import { cookies } from "next/headers";
import { clearNoticeCookieOptions, NOTICE_COOKIE } from "./invite-cookies";

export async function dismissJoinedNotice(): Promise<void> {
  (await cookies()).set(NOTICE_COOKIE, "", clearNoticeCookieOptions);
}
