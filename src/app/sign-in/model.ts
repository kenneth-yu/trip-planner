import { safeNextPath } from "@/domain/auth/next-path";
import { devSignInEnabled } from "@/server/auth/session";
import { enabledProviders, type Env, type ProviderId } from "@/server/auth/providers";
import { USERS } from "@/fixtures/december-trip";

export type SignInProblem = "expired" | "tooMany" | "failed";

export interface SignInModel {
  providers: ProviderId[];
  next: string;
  problem: SignInProblem | null;
  demoAccounts: { key: string; name: string }[];
}

function problemFor(error: string | undefined): SignInProblem | null {
  if (error === undefined) return null;
  if (error === "Verification") return "expired";
  if (error === "TooMany") return "tooMany";
  return "failed";
}

export function signInModel(env: Env, params: { next?: string; error?: string }): SignInModel {
  return {
    providers: enabledProviders(env),
    next: safeNextPath(params.next),
    problem: problemFor(params.error),
    demoAccounts: devSignInEnabled(env) ? Object.entries(USERS).map(([key, u]) => ({ key, name: u.name })) : [],
  };
}
