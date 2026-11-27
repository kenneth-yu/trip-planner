import type { Metadata } from "next";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import pageStyles from "../../ui/page.module.css";
import { currentUser } from "@/server/auth/session";
import { requestContext } from "@/server/app-context";
import { invitePreview } from "@/server/services/sharing-service";
import { continueToSignIn, joinTrip } from "../actions";
import { INVITE_COOKIE } from "../invite-cookies";
import { InviteMessage, PROBLEM_COPY } from "../invite-message";
import { roleInWords } from "../role-words";

export const metadata: Metadata = { title: "Join a trip", robots: { index: false, follow: false } };

export default async function JoinInvitePage() {
  const token = (await cookies()).get(INVITE_COOKIE)?.value;
  if (!token) redirect("/invite/lost");
  const preview = await invitePreview(await requestContext(), token);
  if ("problem" in preview) return <InviteMessage text={PROBLEM_COPY[preview.problem]} />;
  const signedIn = (await currentUser()) !== null;
  return (
    <main className={pageStyles.page}>
      <h1 className={pageStyles.title}>Join {preview.tripName}</h1>
      <p>
        {preview.inviterFirstName} invited you as {roleInWords(preview.role)}.
      </p>
      <form action={signedIn ? joinTrip : continueToSignIn}>
        <button>{signedIn ? "Join this trip" : "Continue"}</button>
      </form>
    </main>
  );
}
