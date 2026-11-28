import { describe, expect, it } from "vitest";
import { eq, getTableColumns } from "drizzle-orm";
import { createAdapter, generateSessionToken } from "./adapter";
import { resolveOAuthSignIn } from "./link";
import { hashToken } from "./tokens";
import * as t from "../db/schema";
import { testContext } from "../testing";
import { present } from "@/testing/present";
import { frozenNow } from "@/testing/clock";
import { USERS } from "@/fixtures/december-trip";

const DAY = 86400_000;

async function setup() {
  const { db } = await testContext({ withItems: false });
  let clock = new Date("2026-11-26T12:00:00Z");
  const adapter = createAdapter(db, () => clock);
  return { db, adapter, advance: (ms: number) => (clock = new Date(clock.getTime() + ms)), now: () => clock };
}

describe("session storage", () => {
  it("stores only the hash of the session token and never the raw token", async () => {
    const { db, adapter, now } = await setup();
    const token = generateSessionToken();
    await present(adapter.createSession)({ sessionToken: token, userId: USERS.kenny.id, expires: new Date(now().getTime() + 30 * DAY) });
    const rows = await db.select().from(t.authSessions);
    expect(rows).toHaveLength(1);
    expect(rows[0].tokenHash).toBe(hashToken(token));
    expect(JSON.stringify(rows)).not.toContain(token);
    for (const column of Object.keys(getTableColumns(t.authSessions))) {
      expect(String(Reflect.get(rows[0], column))).not.toBe(token);
    }
  });

  it("finds the session and its user by the raw token only", async () => {
    const { adapter, now } = await setup();
    const token = generateSessionToken();
    await present(adapter.createSession)({ sessionToken: token, userId: USERS.jacob.id, expires: new Date(now().getTime() + DAY) });
    const found = await present(adapter.getSessionAndUser)(token);
    expect(found?.user.email).toBe(USERS.jacob.email);
    expect(found?.session.sessionToken).toBe(token);
    expect(await present(adapter.getSessionAndUser)(hashToken(token))).toBeNull();
    expect(await present(adapter.getSessionAndUser)("not-a-session")).toBeNull();
  });

  it("returns null for an expired session and deletes its row", async () => {
    const { db, adapter, advance, now } = await setup();
    const token = generateSessionToken();
    await present(adapter.createSession)({ sessionToken: token, userId: USERS.kenny.id, expires: new Date(now().getTime() + DAY) });
    advance(2 * DAY);
    expect(await present(adapter.getSessionAndUser)(token)).toBeNull();
    expect(await db.select().from(t.authSessions)).toHaveLength(0);
  });

  it("deleting a session removes it and extending it moves the expiry", async () => {
    const { db, adapter, now } = await setup();
    const token = generateSessionToken();
    await present(adapter.createSession)({ sessionToken: token, userId: USERS.kenny.id, expires: new Date(now().getTime() + DAY) });
    const later = new Date(now().getTime() + 30 * DAY);
    await present(adapter.updateSession)({ sessionToken: token, expires: later });
    expect((await db.select().from(t.authSessions))[0].expires.getTime()).toBe(later.getTime());
    await present(adapter.deleteSession)(token);
    expect(await db.select().from(t.authSessions)).toHaveLength(0);
  });

  it("deleting a user cascades to sessions and accounts", async () => {
    const { db, adapter, now } = await setup();
    const guest = await present(adapter.createUser)({ id: "g", email: "guest@example.com", emailVerified: null });
    await present(adapter.createSession)({ sessionToken: generateSessionToken(), userId: guest.id, expires: new Date(now().getTime() + DAY) });
    await present(adapter.linkAccount)({ userId: guest.id, type: "oidc", provider: "google", providerAccountId: "g-1" });
    await present(adapter.deleteUser)(guest.id);
    expect(await db.select().from(t.authSessions)).toHaveLength(0);
    expect(await db.select().from(t.authAccounts)).toHaveLength(0);
    expect(await db.select().from(t.users).where(eq(t.users.id, guest.id))).toHaveLength(0);
  });
});

describe("accounts and users", () => {
  it("linkAccount keeps provider, account id and type and drops every provider token", async () => {
    const { db, adapter } = await setup();
    await present(adapter.linkAccount)({
      userId: USERS.kenny.id,
      type: "oidc",
      provider: "google",
      providerAccountId: "g-1",
      access_token: "ya29.secret-access",
      refresh_token: "1//secret-refresh",
      id_token: "eyJ.secret.id",
      expires_at: 123,
      scope: "openid",
    });
    const rows = await db.select().from(t.authAccounts);
    expect(rows).toHaveLength(1);
    expect(Object.keys(rows[0]).sort()).toEqual(["createdAt", "provider", "providerAccountId", "type", "userId"]);
    expect(JSON.stringify(rows)).not.toMatch(/secret/);
  });

  it("creates users with a name from the profile or the email local part and never stores a verified flag", async () => {
    const { adapter } = await setup();
    const named = await present(adapter.createUser)({ id: "x", email: "Ada@Example.com", name: "Ada Lovelace", emailVerified: frozenNow() });
    expect(named.name).toBe("Ada Lovelace");
    expect(named.email).toBe("ada@example.com");
    expect(named.emailVerified).toBeNull();
    const unnamed = await present(adapter.createUser)({ id: "y", email: "grace.hopper@example.com", emailVerified: null });
    expect(unnamed.name).toBe("grace.hopper");
    expect((await present(adapter.getUserByEmail)("GRACE.HOPPER@example.com"))?.id).toBe(unnamed.id);
  });

  it("looks users up by account", async () => {
    const { adapter } = await setup();
    await present(adapter.linkAccount)({ userId: USERS.jacob.id, type: "oidc", provider: "google", providerAccountId: "g-2" });
    expect((await present(adapter.getUserByAccount)({ provider: "google", providerAccountId: "g-2" }))?.id).toBe(USERS.jacob.id);
    expect(await present(adapter.getUserByAccount)({ provider: "apple", providerAccountId: "g-2" })).toBeNull();
  });
});

describe("verification tokens", () => {
  it("stores the token as given, works once and not after it expires", async () => {
    const { db, adapter, now } = await setup();
    const expires = new Date(now().getTime() + 15 * 60_000);
    await present(adapter.createVerificationToken)({ identifier: "kenny@example.com", token: "hashed-by-auth-js", expires });
    expect((await db.select().from(t.authVerificationTokens))[0].tokenHash).toBe("hashed-by-auth-js");
    expect(await present(adapter.useVerificationToken)({ identifier: "other@example.com", token: "hashed-by-auth-js" })).toBeNull();
    const used = await present(adapter.useVerificationToken)({ identifier: "kenny@example.com", token: "hashed-by-auth-js" });
    expect(used?.identifier).toBe("kenny@example.com");
    expect(await present(adapter.useVerificationToken)({ identifier: "kenny@example.com", token: "hashed-by-auth-js" })).toBeNull();
  });

  it("finds a token by its hash when the link carries no address", async () => {
    const { adapter, now } = await setup();
    await present(adapter.createVerificationToken)({ identifier: "kenny@example.com", token: "h2", expires: new Date(now().getTime() + 1000) });
    const linkWithoutAddress = JSON.parse('{"token":"h2"}');
    const used = await present(adapter.useVerificationToken)(linkWithoutAddress);
    expect(used?.identifier).toBe("kenny@example.com");
  });
});

describe("account linking by email", () => {
  const google = { provider: "google", providerAccountId: "g-kenny", type: "oidc" as const };

  it("links a verified Google email to the existing user without storing tokens", async () => {
    const { db, adapter } = await setup();
    const outcome = await resolveOAuthSignIn(adapter, { ...google, email: USERS.kenny.email, emailVerified: true });
    expect(outcome).toBe("allowed");
    const accounts = await db.select().from(t.authAccounts);
    expect(accounts).toHaveLength(1);
    expect(accounts[0].userId).toBe(USERS.kenny.id);
  });

  it("refuses an unverified email and links nothing", async () => {
    const { db, adapter } = await setup();
    expect(await resolveOAuthSignIn(adapter, { ...google, email: USERS.kenny.email, emailVerified: false })).toBe("denied");
    expect(await resolveOAuthSignIn(adapter, { ...google, email: null, emailVerified: true })).toBe("denied");
    expect(await db.select().from(t.authAccounts)).toHaveLength(0);
  });

  it("lets an already linked account sign in and does not re-link it to another user", async () => {
    const { db, adapter } = await setup();
    await resolveOAuthSignIn(adapter, { ...google, email: USERS.kenny.email, emailVerified: true });
    const again = await resolveOAuthSignIn(adapter, { ...google, email: USERS.jacob.email, emailVerified: false });
    expect(again).toBe("allowed");
    const accounts = await db.select().from(t.authAccounts);
    expect(accounts).toHaveLength(1);
    expect(accounts[0].userId).toBe(USERS.kenny.id);
  });

  it("allows a brand new verified email so Auth.js creates the user", async () => {
    const { db, adapter } = await setup();
    expect(await resolveOAuthSignIn(adapter, { ...google, email: "new@example.com", emailVerified: true })).toBe("allowed");
    expect(await db.select().from(t.authAccounts)).toHaveLength(0);
  });
});

describe("rolling sessions", () => {
  it("extends the expiry once a day has passed, and not before", async () => {
    const { db, adapter, advance, now } = await setup();
    const token = generateSessionToken();
    await present(adapter.createSession)({ sessionToken: token, userId: USERS.kenny.id, expires: new Date(now().getTime() + 30 * DAY) });
    const initial = (await db.select().from(t.authSessions))[0].expires.getTime();
    advance(DAY / 2);
    await present(adapter.getSessionAndUser)(token);
    expect((await db.select().from(t.authSessions))[0].expires.getTime()).toBe(initial);
    advance(DAY);
    await present(adapter.getSessionAndUser)(token);
    expect((await db.select().from(t.authSessions))[0].expires.getTime()).toBe(now().getTime() + 30 * DAY);
  });

  it("keeps an active person signed in past 30 days since sign in, and signs out someone idle for 30 days", async () => {
    const { adapter, advance, now } = await setup();
    const active = generateSessionToken();
    const idle = generateSessionToken();
    for (const token of [active, idle]) {
      await present(adapter.createSession)({ sessionToken: token, userId: USERS.kenny.id, expires: new Date(now().getTime() + 30 * DAY) });
    }
    for (let day = 0; day < 40; day++) {
      advance(DAY);
      expect(await present(adapter.getSessionAndUser)(active)).not.toBeNull();
    }
    expect(await present(adapter.getSessionAndUser)(idle)).toBeNull();
  });

  it("issues a cookie that outlives the stored expiry so the roll needs no cookie write", async () => {
    const { adapter, now } = await setup();
    const issued = await present(adapter.createSession)({ sessionToken: generateSessionToken(), userId: USERS.kenny.id, expires: new Date(now().getTime() + 30 * DAY) });
    expect(issued.expires.getTime()).toBe(now().getTime() + 400 * DAY);
  });
});

describe("expired verification tokens", () => {
  it("are purged when the next token is created", async () => {
    const { db, adapter, now } = await setup();
    await present(adapter.createVerificationToken)({ identifier: "old@example.com", token: "old", expires: new Date(now().getTime() + 1000) });
    await present(adapter.createVerificationToken)({ identifier: "live@example.com", token: "live-1", expires: new Date(now().getTime() + 15 * 60_000) });
    expect(await db.select().from(t.authVerificationTokens)).toHaveLength(2);
    const later = new Date(now().getTime() + 60_000);
    const lateAdapter = createAdapter(db, () => later);
    await present(lateAdapter.createVerificationToken)({ identifier: "new@example.com", token: "new", expires: new Date(later.getTime() + 15 * 60_000) });
    const identifiers = (await db.select().from(t.authVerificationTokens)).map((r) => r.identifier).sort();
    expect(identifiers).toEqual(["live@example.com", "new@example.com"]);
  });
});
