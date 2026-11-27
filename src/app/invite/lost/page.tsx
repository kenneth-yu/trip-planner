import type { Metadata } from "next";
import { InviteMessage, LOST_COPY } from "../invite-message";

export const metadata: Metadata = { title: "Invite", robots: { index: false, follow: false } };

export default function LostInvitePage() {
  return <InviteMessage text={LOST_COPY} />;
}
