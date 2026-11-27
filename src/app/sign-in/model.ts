import { safeNextPath } from "@/domain/auth/next-path";
import { devSignInEnabled } from "@/server/auth/session";
import { enabledProviders, type Env, type ProviderId } from "@/server/auth/providers";
import { USERS } from "@/fixtures/december-trip";

export type SignInProblem = "expired" | "failed";

export interface SignInModel {
  providers: ProviderId[];
  next: string;
  problem: SignInProblem | null;
  demoAccounts: { key: string; name: string }[];
}

export function signInModel(env: Env, params: { next?: string; error?: string }): SignInModel {
  return {
    providers: enabledProviders(env),
    next: safeNextPath(params.next),
    problem: params.error === undefined ? null : params.error === "Verification" ? "expired" : "failed",
    demoAccounts: devSignInEnabled(env) ? Object.entries(USERS).map(([key, u]) => ({ key, name: u.name })) : [],
  };
}
