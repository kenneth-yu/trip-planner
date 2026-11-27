import { cookies } from "next/headers";
import { JoinedBanner } from "./joined-banner";
import { NOTICE_COOKIE } from "./invite-cookies";
import { noticeMessage } from "./notice";

export async function JoinedNotice({ tripId }: { tripId: string }) {
  const message = noticeMessage((await cookies()).get(NOTICE_COOKIE)?.value, tripId);
  return message ? <JoinedBanner message={message} /> : null;
}
