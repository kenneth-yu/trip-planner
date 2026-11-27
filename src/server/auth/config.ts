import type { AuthConfig } from "@auth/core";
import type { EmailConfig, Provider } from "@auth/core/providers";
import Apple from "@auth/core/providers/apple";
import Google from "@auth/core/providers/google";
import { safeNextPath } from "@/domain/auth/next-path";
import type { Db } from "../db/client";
import { createAdapter, generateSessionToken, SESSION_MAX_AGE_SECONDS, SESSION_UPDATE_AGE_SECONDS } from "./adapter";
import { SIGN_IN_LINK_MINUTES, signInLinkUrl, type EmailSender } from "./email";
import { isEmailVerified, resolveOAuthSignIn } from "./link";
import { enabledProviders, type Env } from "./providers";

export const SIGN_IN_PATH = "/sign-in";

export function sessionCookieName(env: Env): string {
  return env.NODE_ENV === "production" ? "__Secure-authjs.session-token" : "authjs.session-token";
}

function emailProvider(sender: EmailSender, appOrigin: string): EmailConfig {
  return {
    id: "email",
    type: "email",
    name: "Email",
    from: "",
    maxAge: SIGN_IN_LINK_MINUTES * 60,
    options: {},
    async sendVerificationRequest({ identifier, url }) {
      await sender.sendSignInLink(identifier, signInLinkUrl(url, appOrigin));
    },
  };
}

function providersFor(env: Env, sender: EmailSender | null, appOrigin: string): Provider[] {
  const providers: Provider[] = [];
  for (const id of enabledProviders(env)) {
    if (id === "google") {
      providers.push(Google({ clientId: env.GOOGLE_CLIENT_ID, clientSecret: env.GOOGLE_CLIENT_SECRET, authorization: { params: { scope: "openid email profile" } } }));
    }
    if (id === "apple") providers.push(Apple({ clientId: env.AUTH_APPLE_ID, clientSecret: env.AUTH_APPLE_SECRET }));
    if (id === "email" && sender) providers.push(emailProvider(sender, appOrigin));
  }
  return providers;
}

export function buildAuthConfig(options: { db: Db; env: Env; sender: EmailSender | null; now?: () => Date }): AuthConfig {
  const { db, env, sender } = options;
  const appOrigin = new URL(env.APP_URL ?? "http://localhost:3000").origin;
  const adapter = createAdapter(db, options.now);
  return {
    adapter,
    providers: providersFor(env, sender, appOrigin),
    secret: env.AUTH_SECRET,
    basePath: "/api/auth",
    useSecureCookies: env.NODE_ENV === "production",
    session: { strategy: "database", maxAge: SESSION_MAX_AGE_SECONDS, updateAge: SESSION_UPDATE_AGE_SECONDS, generateSessionToken },
    pages: { signIn: SIGN_IN_PATH, error: SIGN_IN_PATH },
    callbacks: {
      async signIn({ account, profile, user }) {
        if (!account || account.type === "email") return true;
        if (account.type !== "oauth" && account.type !== "oidc") return false;
        const outcome = await resolveOAuthSignIn(adapter, {
          provider: account.provider,
          providerAccountId: account.providerAccountId,
          type: account.type,
          email: profile?.email ?? user.email,
          emailVerified: isEmailVerified(profile),
        });
        return outcome === "allowed";
      },
      async redirect({ url, baseUrl }) {
        const base = new URL(baseUrl);
        const target = new URL(url, base);
        if (target.origin !== base.origin) return base.origin + "/";
        return base.origin + safeNextPath(`${target.pathname}${target.search}${target.hash}`);
      },
    },
  };
}
