"use server";

import { signOut } from "@/server/auth/auth";

export async function signOutAction(): Promise<void> {
  await signOut({ redirectTo: "/sign-in" });
}
