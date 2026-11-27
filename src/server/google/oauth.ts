import { createHmac } from "node:crypto";
import { z } from "zod";
import { GoogleAuthorizationError } from "./calendar-api";
import { appSecret, safeEqual } from "../auth/tokens";

const AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_URL = "https://oauth2.googleapis.com/token";

export interface GoogleOAuthConfig {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
}

export function googleOAuthConfig(appUrl: string): GoogleOAuthConfig | null {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  if (!clientId || !clientSecret) return null;
  return { clientId, clientSecret, redirectUri: `${appUrl}/api/google/callback` };
}

const OAuthStateSchema = z.object({ userId: z.string(), tripId: z.string(), exp: z.number() });
export type OAuthState = z.infer<typeof OAuthStateSchema>;

function stateMac(body: string): string {
  return createHmac("sha256", appSecret()).update(`google-state:${body}`).digest("base64url");
}

export function sealState(state: OAuthState): string {
  const body = Buffer.from(JSON.stringify(state)).toString("base64url");
  return `${body}.${stateMac(body)}`;
}

export function openState(value: string | null, userId: string, nowMs = Date.now()): OAuthState | null {
  if (!value) return null;
  const [body, mac] = value.split(".");
  if (!body || !mac || !safeEqual(mac, stateMac(body))) return null;
  const parsed = OAuthStateSchema.safeParse(JSON.parse(Buffer.from(body, "base64url").toString("utf8")));
  if (!parsed.success) return null;
  const state = parsed.data;
  return state.userId === userId && state.exp > nowMs ? state : null;
}

export function authorizationUrl(cfg: GoogleOAuthConfig, scope: string, state: string, loginHint?: string): string {
  const params = new URLSearchParams({
    client_id: cfg.clientId,
    redirect_uri: cfg.redirectUri,
    response_type: "code",
    scope: `openid email ${scope}`,
    access_type: "offline",
    prompt: "consent",
    include_granted_scopes: "false",
    state,
  });
  if (loginHint) params.set("login_hint", loginHint);
  return `${AUTH_URL}?${params}`;
}

const TokenResponseSchema = z.object({
  access_token: z.string(),
  expires_in: z.number(),
  refresh_token: z.string().optional(),
  scope: z.string(),
  id_token: z.string().optional(),
});
type TokenResponse = z.infer<typeof TokenResponseSchema>;

const IdTokenClaims = z.object({ email: z.string().optional() });

async function tokenRequest(body: Record<string, string>, fetchImpl: typeof fetch): Promise<TokenResponse> {
  const res = await fetchImpl(TOKEN_URL, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams(body) });
  if (!res.ok) {
    const text = await res.text();
    const message = `Google sign in failed: ${res.status}`;
    throw res.status === 400 && text.includes("invalid_grant") ? new GoogleAuthorizationError(res.status, message) : new Error(message);
  }
  return TokenResponseSchema.parse(await res.json());
}

export async function exchangeCode(cfg: GoogleOAuthConfig, code: string, fetchImpl: typeof fetch = fetch) {
  const tokens = await tokenRequest({ code, client_id: cfg.clientId, client_secret: cfg.clientSecret, redirect_uri: cfg.redirectUri, grant_type: "authorization_code" }, fetchImpl);
  if (!tokens.refresh_token) throw new Error("Google did not return a refresh token. Remove the app's access at myaccount.google.com/permissions and connect again.");
  const email = tokens.id_token ? IdTokenClaims.parse(JSON.parse(Buffer.from(tokens.id_token.split(".")[1], "base64url").toString("utf8"))).email : undefined;
  return { refreshToken: tokens.refresh_token, scope: tokens.scope, email };
}

export function accessTokenSource(cfg: GoogleOAuthConfig, refreshToken: string, fetchImpl: typeof fetch = fetch, now = () => Date.now()) {
  let cached: { token: string; expiresAt: number } | null = null;
  return async (): Promise<string> => {
    if (cached && cached.expiresAt - 60_000 > now()) return cached.token;
    const r = await tokenRequest({ refresh_token: refreshToken, client_id: cfg.clientId, client_secret: cfg.clientSecret, grant_type: "refresh_token" }, fetchImpl);
    cached = { token: r.access_token, expiresAt: now() + r.expires_in * 1000 };
    return cached.token;
  };
}
