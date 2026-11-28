import { createHash, createHmac, randomBytes } from "node:crypto";
import { z } from "zod";
import { appSecret, decryptSecret, encryptSecret, safeEqual } from "../auth/tokens";
import { IMPORT_SCOPE } from "./calendar-api";
import { tokenRequest, type GoogleOAuthConfig } from "./oauth";

export const IMPORT_COOKIE = "google_import";
export const IMPORT_SEEN_COOKIE = "google_import_seen";
export const IMPORT_SEEN_MAX_AGE_S = 3600;
export const IMPORT_FLOW_COOKIE = "google_import_flow";
export const IMPORT_FLOW_PATH = "/api/google/import";
export const IMPORT_WINDOW_MS = 10 * 60_000;

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch (e) {
    if (e instanceof SyntaxError) return null;
    throw e;
  }
}

const ImportState = z.object({ userId: z.string(), tripId: z.string(), exp: z.number(), nonce: z.string().min(16) });
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
  const parsed = ImportState.safeParse(parseJson(Buffer.from(body, "base64url").toString("utf8")));
  return parsed.success && parsed.data.userId === userId && parsed.data.exp > nowMs ? parsed.data : null;
}

export class ImportConsentMissing extends Error {
  constructor() {
    super("Google Calendar read access was not granted.");
    this.name = "ImportConsentMissing";
  }
}

const Flow = z.object({ userId: z.string(), tripId: z.string(), nonce: z.string(), verifier: z.string(), exp: z.number() });
export type ImportFlow = z.infer<typeof Flow>;

export function startImportFlow(userId: string, tripId: string, nowMs = Date.now()): { state: string; challenge: string; cookie: { value: string; maxAgeS: number } } {
  const nonce = randomBytes(24).toString("base64url");
  const verifier = randomBytes(48).toString("base64url");
  const exp = nowMs + IMPORT_WINDOW_MS;
  return {
    state: sealImportState({ userId, tripId, exp, nonce }),
    challenge: createHash("sha256").update(verifier).digest("base64url"),
    cookie: { value: encryptSecret(JSON.stringify({ userId, tripId, nonce, verifier, exp })), maxAgeS: IMPORT_WINDOW_MS / 1000 },
  };
}

export function openImportFlow(sealed: string | undefined, state: ImportState, nowMs = Date.now()): ImportFlow | null {
  if (!sealed) return null;
  let text: string;
  try {
    text = decryptSecret(sealed);
  } catch (e) {
    if (e instanceof Error) return null;
    throw e;
  }
  const parsed = Flow.safeParse(parseJson(text));
  if (!parsed.success) return null;
  const flow = parsed.data;
  return flow.exp > nowMs && flow.userId === state.userId && flow.tripId === state.tripId && safeEqual(flow.nonce, state.nonce) ? flow : null;
}

const IdClaims = z.object({ email: z.string().max(320).optional() });

export function emailFromIdToken(idToken: string | undefined): string | undefined {
  const payload = idToken?.split(".")[1];
  if (!payload) return undefined;
  const parsed = IdClaims.safeParse(parseJson(Buffer.from(payload, "base64url").toString("utf8")));
  return parsed.success ? parsed.data.email : undefined;
}

export async function exchangeImportCode(cfg: GoogleOAuthConfig, code: string, verifier: string, fetchImpl: typeof fetch = fetch): Promise<{ accessToken: string; expiresInS: number; email?: string }> {
  const tokens = await tokenRequest({ code, code_verifier: verifier, client_id: cfg.clientId, client_secret: cfg.clientSecret, redirect_uri: cfg.redirectUri, grant_type: "authorization_code" }, fetchImpl);
  if (!tokens.scope.split(" ").includes(IMPORT_SCOPE)) throw new ImportConsentMissing();
  return { accessToken: tokens.access_token, expiresInS: tokens.expires_in, email: emailFromIdToken(tokens.id_token) };
}

const Held = z.object({ userId: z.string(), tripId: z.string(), accessToken: z.string(), email: z.string().optional(), exp: z.number() });

export function sealImportToken(held: { userId: string; tripId: string; accessToken: string; email?: string; expiresInS: number }, nowMs = Date.now()): { value: string; maxAgeS: number } {
  const lifeMs = Math.min(IMPORT_WINDOW_MS, Math.max(0, held.expiresInS * 1000 - 30_000));
  const body = { userId: held.userId, tripId: held.tripId, accessToken: held.accessToken, email: held.email, exp: nowMs + lifeMs };
  return { value: encryptSecret(JSON.stringify(body)), maxAgeS: Math.floor(lifeMs / 1000) };
}

export function openImportToken(sealed: string | undefined, userId: string, tripId: string, nowMs = Date.now()): string | null {
  return openImportHeld(sealed, userId, tripId, nowMs)?.accessToken ?? null;
}

export function openImportHeld(sealed: string | undefined, userId: string, tripId: string, nowMs = Date.now()): { accessToken: string; email?: string } | null {
  if (!sealed) return null;
  let text: string;
  try {
    text = decryptSecret(sealed);
  } catch (e) {
    if (e instanceof Error) return null;
    throw e;
  }
  const parsed = Held.safeParse(parseJson(text));
  return parsed.success && parsed.data.userId === userId && parsed.data.tripId === tripId && parsed.data.exp > nowMs ? { accessToken: parsed.data.accessToken, email: parsed.data.email } : null;
}
