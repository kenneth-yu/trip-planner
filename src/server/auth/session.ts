import { cookies } from "next/headers";
import { eq } from "drizzle-orm";
import { getDb, type Db } from "../db/client";
import * as t from "../db/schema";
import { createAdapter, generateSessionToken, lookupSession, SESSION_MAX_AGE_SECONDS, sessionCookieExpiry, type User } from "./adapter";
import { sessionCookieName } from "./config";
import type { Env } from "./providers";

export type { User };

export async function userForSessionToken(db: Db, sessionToken: string | undefined, now = new Date()): Promise<User | null> {
  if (!sessionToken) return null;
  const found = await lookupSession(db, sessionToken, now);
  return found ? found.user : null;
}

export async function currentUser(): Promise<User | null> {
  const token = (await cookies()).get(sessionCookieName(process.env))?.value;
  if (!token) return null;
  return userForSessionToken(await getDb(), token);
}

export function devSignInEnabled(env: Env = process.env): boolean {
  if (env.DEV_SIGN_IN !== "1") return false;
  if (env.VERCEL_ENV === "production") {
    throw new Error("DEV_SIGN_IN=1 is set on a production deployment. Remove DEV_SIGN_IN from the production environment variables.");
  }
  if (env.VERCEL_ENV === "preview") return true;
  if (env.NODE_ENV === "production") {
    throw new Error("DEV_SIGN_IN=1 is set with NODE_ENV=production. Remove DEV_SIGN_IN, or set VERCEL_ENV=preview on a preview deployment.");
  }
  return true;
}

export async function startDevSession(userId: string): Promise<boolean> {
  const db = await getDb();
  const [user] = await db.select({ id: t.users.id }).from(t.users).where(eq(t.users.id, userId));
  if (!user) return false;
  const token = generateSessionToken();
  const expires = new Date(Date.now() + SESSION_MAX_AGE_SECONDS * 1000);
  await createAdapter(db).createSession?.({ sessionToken: token, userId, expires });
  (await cookies()).set(sessionCookieName(process.env), token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    expires: sessionCookieExpiry(new Date()),
  });
  return true;
}
