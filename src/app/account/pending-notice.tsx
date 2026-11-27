import { cookies } from "next/headers";
import { NOTICE_COOKIE, noticeText } from "./notice";
import { OneTimeNotice } from "./one-time-notice";

export async function PendingNotice() {
  return <OneTimeNotice text={noticeText((await cookies()).get(NOTICE_COOKIE)?.value)} />;
}
