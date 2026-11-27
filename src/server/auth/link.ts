import type { Adapter } from "@auth/core/adapters";
import { z } from "zod";

export type OAuthSignIn = {
  provider: string;
  providerAccountId: string;
  type: "oauth" | "oidc";
  email: string | null | undefined;
  emailVerified: boolean;
};

export type OAuthSignInOutcome = "allowed" | "denied";

const verifiedFlag = z.object({ email_verified: z.union([z.boolean(), z.enum(["true", "false"])]).optional() });

export function isEmailVerified(profile: unknown): boolean {
  const parsed = verifiedFlag.safeParse(profile);
  if (!parsed.success) return false;
  return parsed.data.email_verified === true || parsed.data.email_verified === "true";
}

export async function resolveOAuthSignIn(adapter: Adapter, signIn: OAuthSignIn): Promise<OAuthSignInOutcome> {
  const { getUserByAccount, getUserByEmail, linkAccount } = adapter;
  if (!getUserByAccount || !getUserByEmail || !linkAccount) throw new Error("The auth adapter is missing account methods.");
  const existing = await getUserByAccount({ provider: signIn.provider, providerAccountId: signIn.providerAccountId });
  if (existing) return "allowed";
  if (!signIn.email || !signIn.emailVerified) return "denied";
  const sameEmail = await getUserByEmail(signIn.email);
  if (sameEmail) {
    await linkAccount({ userId: sameEmail.id, type: signIn.type, provider: signIn.provider, providerAccountId: signIn.providerAccountId });
  }
  return "allowed";
}
