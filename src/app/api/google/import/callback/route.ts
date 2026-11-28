import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { appUrl } from "@/server/app-context";
import { currentUser } from "@/server/auth/session";
import { GoogleAuthorizationError } from "@/server/google/calendar-api";
import { FAKE_ACCESS_TOKEN, FAKE_CODE, fakeGoogleActive, IMPORT_CALLBACK_PATH, importIsRateLimited, importOAuthConfig, importPagePath } from "@/server/google/import-guard";
import { exchangeImportCode, IMPORT_COOKIE, IMPORT_FLOW_COOKIE, IMPORT_FLOW_PATH, IMPORT_SEEN_COOKIE, IMPORT_SEEN_MAX_AGE_S, ImportConsentMissing, openImportFlow, openImportState, sealImportToken } from "@/server/google/import-oauth";

type Outcome = { kind: "connected"; sealed: ReturnType<typeof sealImportToken> } | { kind: "declined" | "expired" | "failed" };

export async function GET(request: Request) {
  const user = await currentUser();
  if (!user) redirect("/");
  if (!importIsRateLimited("GET", IMPORT_CALLBACK_PATH)) redirect("/");
  const url = new URL(request.url);
  const jar = await cookies();
  const state = openImportState(url.searchParams.get("state"), user.id);
  const flow = state ? openImportFlow(jar.get(IMPORT_FLOW_COOKIE)?.value, state) : null;
  jar.delete({ name: IMPORT_FLOW_COOKIE, path: IMPORT_FLOW_PATH });
  if (!state) redirect("/");
  const page = importPagePath(state.tripId);
  const cfg = importOAuthConfig(appUrl());
  const code = url.searchParams.get("code");
  let outcome: Outcome;
  if (!flow || !cfg) outcome = { kind: "failed" };
  else if (!code || url.searchParams.get("error")) outcome = { kind: "declined" };
  else {
    try {
      const held = fakeGoogleActive() && code === FAKE_CODE ? { accessToken: FAKE_ACCESS_TOKEN, expiresInS: 3599, email: user.email } : await exchangeImportCode(cfg, code, flow.verifier);
      outcome = { kind: "connected", sealed: sealImportToken({ userId: user.id, tripId: state.tripId, accessToken: held.accessToken, email: held.email, expiresInS: held.expiresInS }) };
    } catch (e) {
      if (e instanceof ImportConsentMissing) outcome = { kind: "declined" };
      else if (e instanceof GoogleAuthorizationError) outcome = { kind: "expired" };
      else if (e instanceof Error) {
        console.error(`Google import sign in failed: ${e.name}: ${e.message}`);
        outcome = { kind: "failed" };
      } else throw e;
    }
  }
  if (outcome.kind !== "connected") redirect(`${page}?consent=${outcome.kind}`);
  jar.set(IMPORT_COOKIE, outcome.sealed.value, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: page,
    maxAge: outcome.sealed.maxAgeS,
  });
  jar.set(IMPORT_SEEN_COOKIE, "1", {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: page,
    maxAge: IMPORT_SEEN_MAX_AGE_S,
  });
  redirect(page);
}
