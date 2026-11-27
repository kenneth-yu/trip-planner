import { randomBytes } from "node:crypto";
import { and, eq, lt } from "drizzle-orm";
import type { Adapter, AdapterUser } from "@auth/core/adapters";
import type { Db } from "../db/client";
import * as t from "../db/schema";
import { hashToken } from "./tokens";

export type User = typeof t.users.$inferSelect;

export const SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 30;
export const SESSION_UPDATE_AGE_SECONDS = 60 * 60 * 24;
export const SESSION_COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 400;

export function sessionCookieExpiry(now: Date): Date {
  return new Date(now.getTime() + SESSION_COOKIE_MAX_AGE_SECONDS * 1000);
}

export function generateSessionToken(): string {
  return randomBytes(32).toString("base64url");
}

function toAdapterUser(user: User): AdapterUser {
  return { id: user.id, name: user.name, email: user.email, emailVerified: null };
}

function normalizeEmail(email: string): string {
  return email.normalize("NFKC").trim().toLowerCase();
}

function nameFor(name: string | null | undefined, email: string): string {
  const fromProfile = name?.trim();
  if (fromProfile) return fromProfile;
  return email.split("@")[0] || email;
}

export async function lookupSession(db: Db, sessionToken: string, now: Date): Promise<{ user: User; expires: Date } | null> {
  const tokenHash = hashToken(sessionToken);
  const [row] = await db
    .select({ user: t.users, expires: t.authSessions.expires })
    .from(t.authSessions)
    .innerJoin(t.users, eq(t.users.id, t.authSessions.userId))
    .where(eq(t.authSessions.tokenHash, tokenHash));
  if (!row) return null;
  if (row.expires.getTime() <= now.getTime()) {
    await db.delete(t.authSessions).where(eq(t.authSessions.tokenHash, tokenHash));
    return null;
  }
  const dueForRoll = row.expires.getTime() - SESSION_MAX_AGE_SECONDS * 1000 + SESSION_UPDATE_AGE_SECONDS * 1000 <= now.getTime();
  if (!dueForRoll) return row;
  const expires = new Date(now.getTime() + SESSION_MAX_AGE_SECONDS * 1000);
  await db.update(t.authSessions).set({ expires }).where(eq(t.authSessions.tokenHash, tokenHash));
  return { user: row.user, expires };
}

export function createAdapter(db: Db, now: () => Date = () => new Date()): Adapter {
  return {
    async createUser(user) {
      const email = normalizeEmail(user.email);
      const [row] = await db.insert(t.users).values({ name: nameFor(user.name, email), email }).returning();
      return toAdapterUser(row);
    },
    async getUser(id) {
      const [row] = await db.select().from(t.users).where(eq(t.users.id, id));
      return row ? toAdapterUser(row) : null;
    },
    async getUserByEmail(email) {
      const [row] = await db.select().from(t.users).where(eq(t.users.email, normalizeEmail(email)));
      return row ? toAdapterUser(row) : null;
    },
    async getUserByAccount({ provider, providerAccountId }) {
      const [row] = await db
        .select({ user: t.users })
        .from(t.authAccounts)
        .innerJoin(t.users, eq(t.users.id, t.authAccounts.userId))
        .where(and(eq(t.authAccounts.provider, provider), eq(t.authAccounts.providerAccountId, providerAccountId)));
      return row ? toAdapterUser(row.user) : null;
    },
    async updateUser(user) {
      const changes: { name?: string; email?: string } = {};
      if (user.name) changes.name = user.name;
      if (user.email) changes.email = normalizeEmail(user.email);
      const [row] =
        Object.keys(changes).length > 0
          ? await db.update(t.users).set(changes).where(eq(t.users.id, user.id)).returning()
          : await db.select().from(t.users).where(eq(t.users.id, user.id));
      if (!row) throw new Error("User not found.");
      return toAdapterUser(row);
    },
    async deleteUser(userId) {
      await db.delete(t.users).where(eq(t.users.id, userId));
    },
    async linkAccount(account) {
      await db
        .insert(t.authAccounts)
        .values({ userId: account.userId, type: account.type, provider: account.provider, providerAccountId: account.providerAccountId })
        .onConflictDoNothing();
    },
    async unlinkAccount({ provider, providerAccountId }) {
      await db.delete(t.authAccounts).where(and(eq(t.authAccounts.provider, provider), eq(t.authAccounts.providerAccountId, providerAccountId)));
    },
    async createSession(session) {
      await db.insert(t.authSessions).values({ tokenHash: hashToken(session.sessionToken), userId: session.userId, expires: session.expires });
      return { ...session, expires: sessionCookieExpiry(now()) };
    },
    async getSessionAndUser(sessionToken) {
      const found = await lookupSession(db, sessionToken, now());
      if (!found) return null;
      return { session: { sessionToken, userId: found.user.id, expires: found.expires }, user: toAdapterUser(found.user) };
    },
    async updateSession(session) {
      if (!session.expires) return null;
      const [row] = await db.update(t.authSessions).set({ expires: session.expires }).where(eq(t.authSessions.tokenHash, hashToken(session.sessionToken))).returning();
      return row ? { sessionToken: session.sessionToken, userId: row.userId, expires: row.expires } : null;
    },
    async deleteSession(sessionToken) {
      await db.delete(t.authSessions).where(eq(t.authSessions.tokenHash, hashToken(sessionToken)));
    },
    async createVerificationToken(verificationToken) {
      await db.delete(t.authVerificationTokens).where(lt(t.authVerificationTokens.expires, now()));
      await db.insert(t.authVerificationTokens).values({
        identifier: verificationToken.identifier,
        tokenHash: verificationToken.token,
        expires: verificationToken.expires,
      });
      return verificationToken;
    },
    async useVerificationToken({ identifier, token }) {
      const matches = identifier
        ? and(eq(t.authVerificationTokens.tokenHash, token), eq(t.authVerificationTokens.identifier, identifier))
        : eq(t.authVerificationTokens.tokenHash, token);
      const [row] = await db.delete(t.authVerificationTokens).where(matches).returning();
      return row ? { identifier: row.identifier, token: row.tokenHash, expires: row.expires } : null;
    },
  };
}
