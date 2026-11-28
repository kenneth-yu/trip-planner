import { redirect } from "next/navigation";
import { z } from "zod";
import { appUrl } from "@/server/app-context";
import { IMPORT_SCOPE } from "@/server/google/calendar-api";
import { IMPORT_CALLBACK_PATH, IMPORT_CLOSED, IMPORT_CONNECT_PATH, importIsRateLimited } from "@/server/google/import-guard";
import { IMPORT_WINDOW_MS, sealImportState } from "@/server/google/import-oauth";
import { authorizationUrl, googleOAuthConfig } from "@/server/google/oauth";
import { loadTripPage } from "@/server/web";

export async function GET(request: Request) {
  if (!importIsRateLimited("GET", IMPORT_CONNECT_PATH)) return new Response(IMPORT_CLOSED, { status: 503 });
  const tripId = z.string().uuid().safeParse(new URL(request.url).searchParams.get("trip"));
  if (!tripId.success) return new Response("Missing trip", { status: 400 });
  const { user, view } = await loadTripPage(tripId.data);
  if (!view.permissions.canEdit) return new Response("Only people who can edit this trip can import into it.", { status: 403 });
  const cfg = googleOAuthConfig(appUrl(), IMPORT_CALLBACK_PATH);
  if (!cfg) return new Response("Google is not set up on this server. Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET.", { status: 503 });
  const state = sealImportState({ userId: user.id, tripId: tripId.data, exp: Date.now() + IMPORT_WINDOW_MS });
  redirect(authorizationUrl(cfg, IMPORT_SCOPE, state, user.email, { offline: false }));
}
