import { createHmac } from "node:crypto";
import { cookies } from "next/headers";
import { eq } from "drizzle-orm";
import { appSecret, safeEqual } from "./tokens";
import { getDb } from "../db/client";
import * as t from "../db/schema";

const COOKIE = "tp_session";
const MAX_AGE_S = 60 * 60 * 24 * 30;

function sign(payload: string): string {
  return createHmac("sha256", appSecret()).update(payload).digest("base64url");
}

export function sealSession(userId: string, nowMs = Date.now()): string {
  const payload = `${userId}.${Math.floor(nowMs / 1000) + MAX_AGE_S}`;
  return `${payload}.${sign(payload)}`;
}

export function openSession(value: string | undefined, nowMs = Date.now()): string | null {
  if (!value) return null;
  const parts = value.split(".");
  if (parts.length !== 3) return null;
  const [userId, exp, mac] = parts;
  if (!safeEqual(mac, sign(`${userId}.${exp}`))) return null;
  return Number(exp) * 1000 > nowMs ? userId : null;
}

export async function startSession(userId: string) {
  (await cookies()).set(COOKIE, sealSession(userId), { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/", maxAge: MAX_AGE_S });
}

export async function endSession() {
  (await cookies()).delete(COOKIE);
}

export async function currentUser() {
  const userId = openSession((await cookies()).get(COOKIE)?.value);
  if (!userId) return null;
  const db = await getDb();
  const [user] = await db.select().from(t.users).where(eq(t.users.id, userId));
  return user ?? null;
}

export function devSignInEnabled(): boolean {
  return process.env.DEV_SIGN_IN === "1" && process.env.NODE_ENV !== "production";
}
