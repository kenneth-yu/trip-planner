import type { Metadata } from "next";
import Link from "next/link";
import pageStyles from "../../ui/page.module.css";
import { currentUser } from "@/server/auth/session";
import { LOST_COPY } from "../invite-message";

export const metadata: Metadata = { title: "Invite", robots: { index: false, follow: false } };

export default async function LostInvitePage() {
  const signedIn = (await currentUser()) !== null;
  return (
    <main className={pageStyles.page}>
      <p role="alert">{LOST_COPY}</p>
      {signedIn && (
        <p>
          <Link href="/" className={pageStyles.muted}>
            Go to your trips
          </Link>
        </p>
      )}
    </main>
  );
}
