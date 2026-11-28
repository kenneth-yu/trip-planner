import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";
import { appUrl } from "@/server/app-context";
import { IMPORT_SCOPE } from "@/server/google/calendar-api";
import { FAKE_CODE, fakeGoogleActive, IMPORT_CALLBACK_PATH, IMPORT_CLOSED, IMPORT_CONNECT_PATH, importIsRateLimited, importOAuthConfig, importPagePath } from "@/server/google/import-guard";
import { IMPORT_FLOW_COOKIE, IMPORT_FLOW_PATH, IMPORT_SEEN_COOKIE, startImportFlow } from "@/server/google/import-oauth";
import { authorizationUrl } from "@/server/google/oauth";
import { loadTripPage } from "@/server/web";

export async function GET(request: Request) {
  const cfg = importOAuthConfig(appUrl());
  if (!cfg) return new Response("Not found", { status: 404 });
  if (!importIsRateLimited("GET", IMPORT_CONNECT_PATH)) return new Response(IMPORT_CLOSED, { status: 503 });
  const tripId = z.string().uuid().safeParse(new URL(request.url).searchParams.get("trip"));
  if (!tripId.success) return new Response("Missing trip", { status: 400 });
  const { user, view } = await loadTripPage(tripId.data);
  if (!view.permissions.canEdit) return new Response("Only people who can edit this trip can import into it.", { status: 403 });
  const flow = startImportFlow(user.id, tripId.data);
  const jar = await cookies();
  jar.delete({ name: IMPORT_SEEN_COOKIE, path: importPagePath(tripId.data) });
  jar.set(IMPORT_FLOW_COOKIE, flow.cookie.value, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: IMPORT_FLOW_PATH,
    maxAge: flow.cookie.maxAgeS,
  });
  if (fakeGoogleActive()) redirect(`${IMPORT_CALLBACK_PATH}?code=${FAKE_CODE}&state=${encodeURIComponent(flow.state)}`);
  redirect(authorizationUrl(cfg, IMPORT_SCOPE, flow.state, user.email, { offline: false, challenge: flow.challenge }));
}
