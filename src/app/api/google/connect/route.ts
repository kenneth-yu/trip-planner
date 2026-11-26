import { redirect } from "next/navigation";
import { currentUser } from "@/server/auth/session";
import { appUrl } from "@/server/app-context";
import { MIRROR_SCOPE } from "@/server/google/calendar-api";
import { authorizationUrl, googleOAuthConfig, sealState } from "@/server/google/oauth";

export async function GET(request: Request) {
  const user = await currentUser();
  if (!user) redirect("/");
  const tripId = new URL(request.url).searchParams.get("trip");
  if (!tripId) return new Response("Missing trip", { status: 400 });
  const cfg = googleOAuthConfig(appUrl());
  if (!cfg) return new Response("Google is not set up on this server. Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET.", { status: 503 });
  const state = sealState({ userId: user.id, tripId, exp: Date.now() + 10 * 60_000 });
  redirect(authorizationUrl(cfg, MIRROR_SCOPE, state, user.email));
}
