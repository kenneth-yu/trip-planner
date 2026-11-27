import type { Metadata } from "next";
import Link from "next/link";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import pageStyles from "../../ui/page.module.css";
import signInStyles from "../../sign-in/sign-in.module.css";
import { signInPath } from "@/domain/auth/next-path";
import { currentUser } from "@/server/auth/session";
import { requestContext } from "@/server/app-context";
import { invitePreview } from "@/server/services/sharing-service";
import { INVITE_COOKIE } from "../invite-cookies";
import { InviteMessage, PROBLEM_COPY } from "../invite-message";
import { roleInWords } from "../role-words";

export const metadata: Metadata = { title: "Join a trip", robots: { index: false, follow: false } };

export default async function JoinInvitePage() {
  const token = (await cookies()).get(INVITE_COOKIE)?.value;
  if (!token) redirect("/invite/lost");
  if (await currentUser()) redirect("/invite/accept");
  const preview = await invitePreview(await requestContext(), token);
  if ("problem" in preview) return <InviteMessage text={PROBLEM_COPY[preview.problem]} />;
  return (
    <main className={pageStyles.page}>
      <h1 className={pageStyles.title}>Join {preview.tripName}</h1>
      <p>
        {preview.inviterFirstName} invited you as {roleInWords(preview.role)}.
      </p>
      <p>
        <Link href={signInPath("/invite/accept")} className={signInStyles.primary}>
          Continue
        </Link>
      </p>
    </main>
  );
}
