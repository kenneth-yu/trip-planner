"use server";

import { cookies } from "next/headers";
import { NOTICE_COOKIE, noticeCookieOptions } from "./notice";

export async function clearOneTimeNotice(): Promise<void> {
  (await cookies()).set(NOTICE_COOKIE, "", { ...noticeCookieOptions, maxAge: 0 });
}
