import { z } from "zod";
import { safeNextPath } from "@/domain/auth/next-path";
import { isLocalDevelopment, type Env } from "./providers";

export interface EmailSender {
  sendSignInLink(to: string, url: string): Promise<void>;
}

export const SIGN_IN_LINK_MINUTES = 15;

export interface DevOutbox {
  sender: EmailSender;
  lastLink(to: string): string | null;
}

export function createDevOutbox(): DevOutbox {
  const links = new Map<string, string>();
  return {
    sender: {
      async sendSignInLink(to, url) {
        links.set(to.toLowerCase(), url);
      },
    },
    lastLink: (to) => links.get(to.toLowerCase()) ?? null,
  };
}

declare global {
  var __devOutbox: DevOutbox | undefined;
}

export function devOutbox(): DevOutbox {
  globalThis.__devOutbox ??= createDevOutbox();
  return globalThis.__devOutbox;
}

export const EMAIL_API_URL = "https://api.resend.com/emails";

export function httpEmailSender(config: { apiKey: string; from: string; fetch?: typeof fetch }): EmailSender {
  const send = config.fetch ?? fetch;
  return {
    async sendSignInLink(to, url) {
      const response = await send(EMAIL_API_URL, {
        method: "POST",
        headers: { Authorization: `Bearer ${config.apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          from: config.from,
          to,
          subject: "Your sign in link",
          text: `Open this link to sign in. It works once and expires in ${SIGN_IN_LINK_MINUTES} minutes.\n\n${url}\n`,
        }),
      });
      if (!response.ok) throw new Error(`The email service refused the message (status ${response.status}).`);
    },
  };
}

export function emailSenderFromEnv(env: Env): EmailSender {
  if (env.EMAIL_API_KEY && env.EMAIL_FROM) return httpEmailSender({ apiKey: env.EMAIL_API_KEY, from: env.EMAIL_FROM });
  if (isLocalDevelopment(env)) return devOutbox().sender;
  throw new Error("Email sign in is not configured. Set EMAIL_API_KEY and EMAIL_FROM.");
}

const callbackParam = z.string().min(1);

export function signInLinkUrl(authUrl: string, appOrigin: string): string {
  const raw = new URL(authUrl);
  const origin = new URL(appOrigin).origin;
  const link = new URL(`${raw.pathname}`, origin);
  const token = raw.searchParams.get("token");
  if (!token) throw new Error("The sign in link has no token.");
  const callback = callbackParam.safeParse(raw.searchParams.get("callbackUrl"));
  if (callback.success) {
    const target = new URL(callback.data, raw.origin);
    link.searchParams.set("callbackUrl", target.origin === raw.origin ? safeNextPath(`${target.pathname}${target.search}${target.hash}`) : "/");
  }
  link.searchParams.set("token", token);
  return link.toString();
}
