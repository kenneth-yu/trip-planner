import { describe, expect, it } from "vitest";
import { z } from "zod";
import { createDevOutbox, emailSenderFromEnv, EMAIL_API_URL, httpEmailSender, signInLinkUrl } from "./email";
import { devOutbox } from "./email";

describe("dev outbox", () => {
  it("keeps the last link per address", async () => {
    const outbox = createDevOutbox();
    await outbox.sender.sendSignInLink("Kenny@example.com", "https://x.test/one");
    await outbox.sender.sendSignInLink("kenny@example.com", "https://x.test/two");
    expect(outbox.lastLink("kenny@example.com")).toBe("https://x.test/two");
    expect(outbox.lastLink("jacob@example.com")).toBeNull();
  });
});

describe("production sender", () => {
  it("sends only to, from, subject and the link to the email API", async () => {
    const calls: { url: string; init: RequestInit | undefined }[] = [];
    const fakeFetch: typeof fetch = async (url, init) => {
      calls.push({ url: String(url), init });
      return new Response("{}", { status: 200 });
    };
    const sender = httpEmailSender({ apiKey: "key-123", from: "Trips <trips@example.com>", fetch: fakeFetch });
    await sender.sendSignInLink("kenny@example.com", "https://trips.test/api/auth/callback/email?token=abc");
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe(EMAIL_API_URL);
    const body = z.object({ from: z.string(), to: z.string(), subject: z.string(), text: z.string() }).strict().parse(JSON.parse(String(calls[0].init?.body)));
    expect(body.to).toBe("kenny@example.com");
    expect(body.from).toBe("Trips <trips@example.com>");
    expect(body.text).toContain("https://trips.test/api/auth/callback/email?token=abc");
    expect(body.text).toContain("15 minutes");
    expect(new Headers(calls[0].init?.headers).get("authorization")).toBe("Bearer key-123");
  });

  it("fails without echoing the address or the link when the service refuses", async () => {
    const sender = httpEmailSender({ apiKey: "k", from: "a@example.com", fetch: async () => new Response("no", { status: 422 }) });
    const [outcome] = await Promise.allSettled([sender.sendSignInLink("kenny@example.com", "https://trips.test/l?token=abc")]);
    expect(outcome.status).toBe("rejected");
    const reason = String(outcome.status === "rejected" ? outcome.reason : "");
    expect(reason).toContain("422");
    expect(reason).not.toContain("kenny@example.com");
    expect(reason).not.toContain("token=abc");
  });

  it("is chosen from the environment, and refuses to exist when nothing is configured", () => {
    expect(() => emailSenderFromEnv({ NODE_ENV: "production" })).toThrow(/EMAIL_API_KEY/);
    expect(() => emailSenderFromEnv({ NODE_ENV: "production", DEV_SIGN_IN: "1" })).toThrow(/EMAIL_API_KEY/);
    expect(emailSenderFromEnv({ NODE_ENV: "development", DEV_SIGN_IN: "1" })).toBe(devOutbox().sender);
    expect(emailSenderFromEnv({ EMAIL_API_KEY: "k", EMAIL_FROM: "a@example.com" })).not.toBe(devOutbox().sender);
  });
});

describe("sign in link", () => {
  const raw = "http://evil.test/api/auth/callback/email?callbackUrl=http%3A%2F%2Fevil.test%2Ftrips%2Fx%3Fday%3D2026-12-05&token=tok123&email=kenny%40example.com";

  it("is rebuilt on the configured app origin, without the email address", () => {
    const link = new URL(signInLinkUrl(raw, "https://trips.example.org"));
    expect(link.origin).toBe("https://trips.example.org");
    expect(link.pathname).toBe("/api/auth/callback/email");
    expect(link.searchParams.get("token")).toBe("tok123");
    expect(link.searchParams.get("email")).toBeNull();
    expect(link.search).not.toContain("kenny");
    expect(link.searchParams.get("callbackUrl")).toBe("/trips/x?day=2026-12-05");
  });

  it("falls back to the home page for a foreign or unsafe callback", () => {
    const foreign = "http://x.test/api/auth/callback/email?callbackUrl=https%3A%2F%2Fevil.example%2Fsteal&token=t";
    expect(new URL(signInLinkUrl(foreign, "https://trips.example.org")).searchParams.get("callbackUrl")).toBe("/");
  });

  it("refuses a link with no token", () => {
    expect(() => signInLinkUrl("http://x.test/api/auth/callback/email", "https://trips.example.org")).toThrow();
  });
});
