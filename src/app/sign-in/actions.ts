"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { safeNextPath } from "@/domain/auth/next-path";
import { signIn } from "@/server/auth/auth";
import { enabledProviders } from "@/server/auth/providers";

export type EmailLinkState = { status: "idle" } | { status: "sent"; email: string } | { status: "failed" };

const providerForm = z.object({ provider: z.enum(["google", "apple"]), next: z.string().optional() });
const emailForm = z.object({ email: z.email(), next: z.string().optional() });

export async function continueWithProvider(formData: FormData): Promise<void> {
  const parsed = providerForm.safeParse({ provider: formData.get("provider"), next: formData.get("next") ?? undefined });
  if (!parsed.success || !enabledProviders(process.env).includes(parsed.data.provider)) redirect("/sign-in");
  await signIn(parsed.data.provider, { redirectTo: safeNextPath(parsed.data.next) });
}

export async function sendEmailLink(_previous: EmailLinkState, formData: FormData): Promise<EmailLinkState> {
  const parsed = emailForm.safeParse({ email: formData.get("email"), next: formData.get("next") ?? undefined });
  if (!parsed.success || !enabledProviders(process.env).includes("email")) return { status: "failed" };
  try {
    const result = await signIn("email", { email: parsed.data.email, redirect: false, redirectTo: safeNextPath(parsed.data.next) });
    if (!new URL(result, "http://localhost").pathname.endsWith("/verify-request")) return { status: "failed" };
    return { status: "sent", email: parsed.data.email };
  } catch (error) {
    console.error(`Sign in link was not sent (${error instanceof Error ? error.name : "unknown error"}).`);
    return { status: "failed" };
  }
}
