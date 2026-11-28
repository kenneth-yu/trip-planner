import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { appUrl } from "@/server/app-context";
import { currentUser } from "@/server/auth/session";
import { IMPORT_CALLBACK_PATH, IMPORT_CLOSED, importIsRateLimited, importPagePath } from "@/server/google/import-guard";
import { exchangeImportCode, IMPORT_COOKIE, ImportConsentMissing, openImportState, sealImportToken } from "@/server/google/import-oauth";
import { googleOAuthConfig } from "@/server/google/oauth";

export async function GET(request: Request) {
  if (!importIsRateLimited("GET", IMPORT_CALLBACK_PATH)) return new Response(IMPORT_CLOSED, { status: 503 });
  const user = await currentUser();
  if (!user) redirect("/");
  const url = new URL(request.url);
  const state = openImportState(url.searchParams.get("state"), user.id);
  const cfg = googleOAuthConfig(appUrl(), IMPORT_CALLBACK_PATH);
  if (!state || !cfg) return new Response("That Google sign in did not finish. Go back and try again.", { status: 400 });
  const code = url.searchParams.get("code");
  if (!code) redirect(`${importPagePath(state.tripId)}?consent=declined`);
  try {
    const held = await exchangeImportCode(cfg, code);
    const sealed = sealImportToken({ userId: user.id, tripId: state.tripId, accessToken: held.accessToken, expiresInS: held.expiresInS });
    (await cookies()).set(IMPORT_COOKIE, sealed.value, {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: importPagePath(state.tripId),
      maxAge: sealed.maxAgeS,
    });
  } catch (e) {
    if (e instanceof ImportConsentMissing) redirect(`${importPagePath(state.tripId)}?consent=declined`);
    throw e;
  }
  redirect(importPagePath(state.tripId));
}
