"use client";

import { useActionState, useState } from "react";
import pageStyles from "../ui/page.module.css";
import styles from "./sign-in.module.css";
import { isInvitePath } from "@/domain/auth/next-path";
import { continueWithProvider, sendEmailLink, type EmailLinkState } from "./actions";
import type { SignInModel } from "./model";

const idle: EmailLinkState = { status: "idle" };

const PROBLEM_COPY = {
  expired: "That link has expired or was already used. Request a new one.",
  tooMany: "Too many sign in attempts. Wait a few minutes and try again.",
  failed: "We could not sign you in. Try again.",
} as const;

function ProviderButton({ provider, next, label, primary }: { provider: "google" | "apple"; next: string; label: string; primary: boolean }) {
  return (
    <form action={continueWithProvider}>
      <input type="hidden" name="provider" value={provider} />
      <input type="hidden" name="next" value={next} />
      <button type="submit" className={primary ? styles.primary : styles.secondary}>
        {label}
      </button>
    </form>
  );
}

export function SignInScreen({ providers, next, problem, demoAccounts }: SignInModel) {
  const [state, action, pending] = useActionState(sendEmailLink, idle);
  const [dismissed, setDismissed] = useState<EmailLinkState | null>(null);
  const hasGoogle = providers.includes("google");
  const hasApple = providers.includes("apple");
  const hasEmail = providers.includes("email");

  if (state.status === "sent" && state !== dismissed) {
    return (
      <main className={pageStyles.page}>
        <h1 className={pageStyles.title}>Check your email</h1>
        <p>We sent a sign in link to {state.email}. It works once and expires in 15 minutes.</p>
        <button type="button" className={styles.secondary} onClick={() => setDismissed(state)}>
          Use a different email
        </button>
      </main>
    );
  }

  const message = state.status === "failed" ? "We could not send that. Try again in a minute." : state.status === "limited" ? PROBLEM_COPY.tooMany : problem ? PROBLEM_COPY[problem] : null;

  return (
    <main className={pageStyles.page}>
      <h1 className={pageStyles.title}>Sign in</h1>
      {isInvitePath(next) && <p className={pageStyles.muted}>Use the account your trip invite was sent to.</p>}
      {next.startsWith("/trips/") && <p className={pageStyles.muted}>Sign in to see this trip.</p>}
      {message && (
        <p role="alert" className={pageStyles.warning}>
          {message}
        </p>
      )}
      <div className={styles.stack}>
        {hasGoogle && <ProviderButton provider="google" next={next} label="Continue with Google" primary />}
        {hasApple && <ProviderButton provider="apple" next={next} label="Continue with Apple" primary={!hasGoogle} />}
      </div>
      {hasEmail && (
        <>
          {(hasGoogle || hasApple) && <p className={styles.or}>or</p>}
          <form action={action} className={styles.stack}>
            <input type="hidden" name="next" value={next} />
            <label htmlFor="email">Email</label>
            <input id="email" name="email" type="email" autoComplete="email" inputMode="email" required className={styles.field} />
            <button type="submit" className={hasGoogle || hasApple ? styles.secondary : styles.primary} disabled={pending}>
              Email me a link
            </button>
          </form>
        </>
      )}
      {demoAccounts.length > 0 && (
        <section className={pageStyles.section}>
          <p className={pageStyles.muted}>Demo accounts, for testing only</p>
          <ul className={pageStyles.list}>
            {demoAccounts.map((account) => (
              <li key={account.key}>
                <a href={`/api/dev/sign-in?as=${account.key}&next=${encodeURIComponent(next)}`}>Continue as {account.name}</a>
              </li>
            ))}
          </ul>
        </section>
      )}
    </main>
  );
}
