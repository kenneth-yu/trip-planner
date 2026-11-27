import { beforeAll, describe, expect, it } from "vitest";
import { Auth } from "@auth/core";
import { eq } from "drizzle-orm";
import { buildAuthConfig } from "./config";
import { createDevOutbox } from "./email";
import { hashToken } from "./tokens";
import * as t from "../db/schema";
import { testContext } from "../testing";
import { present } from "@/testing/present";
import { USERS } from "@/fixtures/december-trip";
import type { Db } from "../db/client";

const ORIGIN = "https://trips.example.org";

class Browser {
  private cookies = new Map<string, string>();

  constructor(private readonly config: ReturnType<typeof buildAuthConfig>) {}

  async send(path: string, init: { method?: string; form?: Record<string, string>; host?: string } = {}) {
    const headers = new Headers({ cookie: [...this.cookies].map(([k, v]) => `${k}=${v}`).join("; ") });
    if (init.form) headers.set("content-type", "application/x-www-form-urlencoded");
    const request = new Request(new URL(path, init.host ?? ORIGIN), { method: init.method ?? "GET", headers, body: init.form ? new URLSearchParams(init.form) : undefined });
    const response = await Auth(request, { ...this.config, trustHost: true });
    for (const line of response.headers.getSetCookie()) {
      const [pair] = line.split(";");
      const [name, ...rest] = pair.split("=");
      if (rest.join("=") === "" || /max-age=0|expires=thu, 01 jan 1970/i.test(line)) this.cookies.delete(name);
      else this.cookies.set(name, rest.join("="));
    }
    return response;
  }

  async csrf(): Promise<string> {
    const body: { csrfToken: string } = await (await this.send("/api/auth/csrf")).json();
    return body.csrfToken;
  }

  cookie(name: string): string | undefined {
    return this.cookies.get(name);
  }
}

const PRODUCTION_ENV = { APP_URL: ORIGIN, AUTH_SECRET: "test-auth-secret-test-auth-secret", NODE_ENV: "production", EMAIL_API_KEY: "k", EMAIL_FROM: "a@example.com" };

async function setup() {
  const { db } = await testContext({ withItems: false });
  const outbox = createDevOutbox();
  const browserFor = () => new Browser(buildAuthConfig({ db, env: PRODUCTION_ENV, sender: outbox.sender }));
  return { db, outbox, browser: browserFor(), browserFor };
}

async function requestLink(browser: Browser, email: string, next: string) {
  const csrfToken = await browser.csrf();
  return browser.send("/api/auth/signin/email", { method: "POST", form: { csrfToken, email, callbackUrl: next } });
}

describe("email link sign in through Auth.js", () => {
  let shared: Awaited<ReturnType<typeof setup>>;
  let db: Db;

  beforeAll(async () => {
    shared = await setup();
    db = shared.db;
  });

  it("signs an existing user in once, with a hashed session and a hardened cookie, and lands on the deep link", async () => {
    const { browser, outbox } = shared;
    const sent = await requestLink(browser, USERS.kenny.email, "/trips/x?day=2026-12-05");
    expect(sent.status).toBe(302);
    const link = present(outbox.lastLink(USERS.kenny.email));
    expect(new URL(link).origin).toBe(ORIGIN);
    expect(link).not.toContain("kenny");

    const callback = await browser.send(new URL(link).pathname + new URL(link).search);
    expect(callback.status).toBe(302);
    expect(new URL(present(callback.headers.get("location")), ORIGIN).pathname + new URL(present(callback.headers.get("location")), ORIGIN).search).toBe("/trips/x?day=2026-12-05");

    const setCookie = callback.headers.getSetCookie().find((c) => c.startsWith("__Secure-authjs.session-token="));
    const cookieLine = present(setCookie);
    expect(cookieLine).toMatch(/HttpOnly/i);
    expect(cookieLine).toMatch(/Secure/i);
    expect(cookieLine).toMatch(/SameSite=Lax/i);
    expect(cookieLine).toMatch(/Path=\//);
    expect(cookieLine).toMatch(/Expires=/i);

    const raw = present(browser.cookie("__Secure-authjs.session-token"));
    const rows = await db.select().from(t.authSessions).where(eq(t.authSessions.userId, USERS.kenny.id));
    expect(rows.map((r) => r.tokenHash)).toContain(hashToken(raw));
    expect(JSON.stringify(rows)).not.toContain(raw);
    expect(await db.select().from(t.users).where(eq(t.users.email, USERS.kenny.email))).toHaveLength(1);

    const session = await (await browser.send("/api/auth/session")).json();
    expect(session.user.email).toBe(USERS.kenny.email);
  });

  it("rejects a used link", async () => {
    const { browser, outbox } = shared;
    await requestLink(browser, USERS.jacob.email, "/");
    const link = new URL(present(outbox.lastLink(USERS.jacob.email)));
    expect((await browser.send(link.pathname + link.search)).headers.get("location")).not.toMatch(/error/);
    const again = await shared.browserFor().send(link.pathname + link.search);
    expect(present(again.headers.get("location"))).toContain("/sign-in?error=Verification");
  });

  it("rejects an expired link", async () => {
    const { browser, outbox } = shared;
    await requestLink(browser, USERS.jacob.email, "/");
    const link = new URL(present(outbox.lastLink(USERS.jacob.email)));
    await db.update(t.authVerificationTokens).set({ expires: new Date(Date.now() - 1000) });
    const response = await shared.browserFor().send(link.pathname + link.search);
    expect(present(response.headers.get("location"))).toContain("/sign-in?error=Verification");
  });

  it("stores the verification token only as a hash", async () => {
    const { browser, outbox } = shared;
    await requestLink(browser, "stored@example.com", "/");
    const token = present(new URL(present(outbox.lastLink("stored@example.com"))).searchParams.get("token"));
    const rows = await db.select().from(t.authVerificationTokens).where(eq(t.authVerificationTokens.identifier, "stored@example.com"));
    expect(rows).toHaveLength(1);
    expect(JSON.stringify(rows)).not.toContain(token);
  });

  it("creates a new user named from the email local part on first sign in", async () => {
    const { browser, outbox } = shared;
    await requestLink(browser, "Ada.Lovelace@Example.com", "/");
    const link = new URL(present(outbox.lastLink("ada.lovelace@example.com")));
    await browser.send(link.pathname + link.search);
    const [user] = await db.select().from(t.users).where(eq(t.users.email, "ada.lovelace@example.com"));
    expect(present(user).name).toBe("ada.lovelace");
  });

  it("builds the link on the configured origin and keeps only a path when the request carries a forged host", async () => {
    const { browser, outbox } = shared;
    const csrfToken = await browser.csrf();
    await browser.send("/api/auth/signin/email", { method: "POST", host: "https://evil.example", form: { csrfToken, email: "host@example.com", callbackUrl: "https://evil.example/steal" } });
    const link = new URL(present(outbox.lastLink("host@example.com")));
    expect(link.origin).toBe(ORIGIN);
    expect(link.searchParams.get("callbackUrl")).toBe("/steal");
  });

  it("does not sign in without a CSRF token", async () => {
    const { browser, outbox } = shared;
    const response = await browser.send("/api/auth/signin/email", { method: "POST", form: { email: "csrf@example.com", callbackUrl: "/" } });
    expect(response.headers.get("location") ?? "").toMatch(/error|csrf/i);
    expect(outbox.lastLink("csrf@example.com")).toBeNull();
  });

  it("signing out deletes the session row and clears the cookie", async () => {
    const { browser, outbox } = shared;
    await requestLink(browser, USERS.kenny.email, "/");
    const link = new URL(present(outbox.lastLink(USERS.kenny.email)));
    await browser.send(link.pathname + link.search);
    const raw = present(browser.cookie("__Secure-authjs.session-token"));
    const csrfToken = await browser.csrf();
    const out = await browser.send("/api/auth/signout", { method: "POST", form: { csrfToken, callbackUrl: "/sign-in" } });
    expect(out.status).toBe(302);
    expect(browser.cookie("__Secure-authjs.session-token")).toBeUndefined();
    expect(await db.select().from(t.authSessions).where(eq(t.authSessions.tokenHash, hashToken(raw)))).toHaveLength(0);
    expect(await (await browser.send("/api/auth/session")).json()).toBeNull();
  });

  it("issues a new session token on every sign in", async () => {
    const { outbox } = shared;
    const first = shared.browserFor();
    const second = shared.browserFor();
    const tokens: string[] = [];
    for (const browser of [first, second]) {
      await requestLink(browser, USERS.jacob.email, "/");
      const link = new URL(present(outbox.lastLink(USERS.jacob.email)));
      await browser.send(link.pathname + link.search);
      tokens.push(present(browser.cookie("__Secure-authjs.session-token")));
    }
    expect(tokens[0]).not.toBe(tokens[1]);
  });
});

describe("oauth sign in decisions through the Auth.js callback", () => {
  let database: Db;

  beforeAll(async () => {
    database = (await testContext({ withItems: false })).db;
  });

  async function signIn(email: string | undefined, verified: unknown, providerAccountId: string) {
    await database.delete(t.authAccounts);
    const config = buildAuthConfig({ db: database, env: { APP_URL: ORIGIN }, sender: null });
    const callback = present(config.callbacks?.signIn);
    const result = await callback({
      user: { id: "u", email: email ?? "" , emailVerified: null },
      account: { type: "oidc", provider: "google", providerAccountId },
      profile: JSON.parse(JSON.stringify({ email, email_verified: verified })),
    });
    return { result, database };
  }

  it("links a verified Google email to the existing person and signs them in", async () => {
    const { result, database } = await signIn(USERS.kenny.email, true, "g-1");
    expect(result).toBe(true);
    expect((await database.select().from(t.authAccounts))[0].userId).toBe(USERS.kenny.id);
  });

  it("denies a Google profile whose email is not verified, and links nothing", async () => {
    for (const verified of [false, "false", undefined, "yes"]) {
      const { result, database } = await signIn(USERS.kenny.email, verified, "g-2");
      expect(result).toBe(false);
      expect(await database.select().from(t.authAccounts)).toHaveLength(0);
    }
  });

  it("accepts Apple's string form of a verified email", async () => {
    const { result } = await signIn(USERS.jacob.email, "true", "a-1");
    expect(result).toBe(true);
  });

  it("never enables dangerous email account linking on any provider", () => {
    const config = buildAuthConfig({
      db: database,
      env: { APP_URL: ORIGIN, GOOGLE_CLIENT_ID: "i", GOOGLE_CLIENT_SECRET: "s", AUTH_APPLE_ID: "i", AUTH_APPLE_SECRET: "s", EMAIL_API_KEY: "k", EMAIL_FROM: "a@example.com" },
      sender: createDevOutbox().sender,
    });
    expect(config.providers).toHaveLength(3);
    for (const provider of config.providers) {
      expect(Reflect.get(provider, "allowDangerousEmailAccountLinking")).toBeFalsy();
      expect(Reflect.get(Reflect.get(provider, "options") ?? {}, "allowDangerousEmailAccountLinking")).toBeFalsy();
    }
  });
});

describe("production configuration", () => {
  it("refuses to build without APP_URL, so a link can never point at localhost", async () => {
    const { db } = await testContext({ withItems: false });
    expect(() => buildAuthConfig({ db, env: { NODE_ENV: "production" }, sender: null })).toThrow(/APP_URL/);
    expect(() => buildAuthConfig({ db, env: { NODE_ENV: "production", VERCEL_ENV: "production" }, sender: null })).toThrow(/APP_URL/);
  });

  it("builds on a preview deployment without APP_URL when no email link is sent, so sign out works there", async () => {
    const { db } = await testContext({ withItems: false });
    const preview = { NODE_ENV: "production", VERCEL_ENV: "preview", AUTH_SECRET: "test-auth-secret-test-auth-secret" };
    const outbox = createDevOutbox();
    expect(() => buildAuthConfig({ db, env: preview, sender: null })).not.toThrow();
    expect(() => buildAuthConfig({ db, env: preview, sender: outbox.sender })).toThrow(/APP_URL/);
  });
});

describe("redirect callback", () => {
  it("keeps same origin paths and sends everything else home", async () => {
    const { db } = await testContext({ withItems: false });
    const redirect = present(buildAuthConfig({ db, env: { APP_URL: ORIGIN }, sender: null }).callbacks?.redirect);
    expect(await redirect({ url: "/trips/x?day=2026-12-05", baseUrl: ORIGIN })).toBe(`${ORIGIN}/trips/x?day=2026-12-05`);
    expect(await redirect({ url: `${ORIGIN}/invite/accept`, baseUrl: ORIGIN })).toBe(`${ORIGIN}/invite/accept`);
    expect(await redirect({ url: "https://evil.example/x", baseUrl: ORIGIN })).toBe(`${ORIGIN}/`);
    expect(await redirect({ url: "//evil.example", baseUrl: ORIGIN })).toBe(`${ORIGIN}/`);
    expect(await redirect({ url: "/\\evil.example", baseUrl: ORIGIN })).toBe(`${ORIGIN}/`);
  });
});
