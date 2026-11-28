import { ruleForRequest } from "../security/rate-limit";
import { googleCalendarReader, type GoogleCalendarReader } from "./calendar-api";
import { googleOAuthConfig, type GoogleOAuthConfig } from "./oauth";

export const IMPORT_CLOSED = "Google Calendar import is not open yet.";

export const IMPORT_CONNECT_PATH = "/api/google/import/connect";
export const IMPORT_CALLBACK_PATH = "/api/google/import/callback";
export const FAKE_CODE = "fake-google-code";
export const FAKE_ACCESS_TOKEN = "fake-google-access-token";

type Env = Record<string, string | undefined>;

export function fakeGoogleActive(env: Env = process.env): boolean {
  return env.GOOGLE_IMPORT_FAKE === "1" && env.DEV_SIGN_IN === "1" && env.VERCEL_ENV !== "production";
}

export function importOAuthConfig(appUrl: string): GoogleOAuthConfig | null {
  const real = googleOAuthConfig(appUrl, IMPORT_CALLBACK_PATH);
  if (real || !fakeGoogleActive()) return real;
  return { clientId: "fake", clientSecret: "fake", redirectUri: `${appUrl}${IMPORT_CALLBACK_PATH}` };
}

export async function importReader(token: string): Promise<GoogleCalendarReader> {
  if (fakeGoogleActive() && token === FAKE_ACCESS_TOKEN) return (await import("./fake-import")).fakeImportAccount();
  return googleCalendarReader(async () => token);
}

export function importPagePath(tripId: string): string {
  return `/trips/${tripId}/import/google`;
}

export function importIsRateLimited(method: string, path: string): boolean {
  return fakeGoogleActive() || ruleForRequest(method, path) !== null;
}
