import { createHmac } from "node:crypto";
import { z } from "zod";
import { appSecret, decryptSecret, encryptSecret, safeEqual } from "../auth/tokens";
import { IMPORT_SCOPE } from "./calendar-api";
import { tokenRequest, type GoogleOAuthConfig } from "./oauth";

export const IMPORT_COOKIE = "google_import";
export const IMPORT_WINDOW_MS = 10 * 60_000;

const ImportState = z.object({ userId: z.string(), tripId: z.string(), exp: z.number() });
export type ImportState = z.infer<typeof ImportState>;

const mac = (body: string) => createHmac("sha256", appSecret()).update(`google-import-state:${body}`).digest("base64url");

export function sealImportState(state: ImportState): string {
  const body = Buffer.from(JSON.stringify(state)).toString("base64url");
  return `${body}.${mac(body)}`;
}

export function openImportState(value: string | null, userId: string, nowMs = Date.now()): ImportState | null {
  if (!value) return null;
  const [body, signature] = value.split(".");
  if (!body || !signature || !safeEqual(signature, mac(body))) return null;
  const parsed = ImportState.safeParse(JSON.parse(Buffer.from(body, "base64url").toString("utf8")));
  return parsed.success && parsed.data.userId === userId && parsed.data.exp > nowMs ? parsed.data : null;
}

export class ImportConsentMissing extends Error {
  constructor() {
    super("Google Calendar read access was not granted.");
    this.name = "ImportConsentMissing";
  }
}

export async function exchangeImportCode(cfg: GoogleOAuthConfig, code: string, fetchImpl: typeof fetch = fetch): Promise<{ accessToken: string; expiresInS: number }> {
  const tokens = await tokenRequest({ code, client_id: cfg.clientId, client_secret: cfg.clientSecret, redirect_uri: cfg.redirectUri, grant_type: "authorization_code" }, fetchImpl);
  if (!tokens.scope.split(" ").includes(IMPORT_SCOPE)) throw new ImportConsentMissing();
  return { accessToken: tokens.access_token, expiresInS: tokens.expires_in };
}

const Held = z.object({ userId: z.string(), tripId: z.string(), accessToken: z.string(), exp: z.number() });

export function sealImportToken(held: { userId: string; tripId: string; accessToken: string; expiresInS: number }, nowMs = Date.now()): { value: string; maxAgeS: number } {
  const lifeMs = Math.min(IMPORT_WINDOW_MS, Math.max(0, held.expiresInS * 1000 - 30_000));
  const body = { userId: held.userId, tripId: held.tripId, accessToken: held.accessToken, exp: nowMs + lifeMs };
  return { value: encryptSecret(JSON.stringify(body)), maxAgeS: Math.floor(lifeMs / 1000) };
}

export function openImportToken(sealed: string | undefined, userId: string, tripId: string, nowMs = Date.now()): string | null {
  if (!sealed) return null;
  let text: string;
  try {
    text = decryptSecret(sealed);
  } catch (e) {
    if (e instanceof Error) return null;
    throw e;
  }
  const parsed = Held.safeParse(JSON.parse(text));
  return parsed.success && parsed.data.userId === userId && parsed.data.tripId === tripId && parsed.data.exp > nowMs ? parsed.data.accessToken : null;
}
