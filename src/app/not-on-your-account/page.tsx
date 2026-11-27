import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { currentUser } from "@/server/auth/session";
import { signOutAction } from "../sign-out/actions";
import { NotOnYourAccount } from "./not-on-your-account";

export const metadata: Metadata = { title: "Trip not on your account", robots: { index: false, follow: false } };

export default async function NotOnYourAccountPage() {
  if (!(await currentUser())) redirect("/sign-in");
  return <NotOnYourAccount signOut={signOutAction} />;
}
