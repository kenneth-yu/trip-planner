import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { InviteMessage, PROBLEM_COPY } from "../../invite-message";

export const metadata: Metadata = { title: "Invite", robots: { index: false, follow: false } };

export default async function InviteProblemPage({ params }: PageProps<"/invite/problem/[kind]">) {
  const { kind } = await params;
  if (kind !== "expired" && kind !== "unusable") notFound();
  return <InviteMessage text={PROBLEM_COPY[kind]} />;
}
