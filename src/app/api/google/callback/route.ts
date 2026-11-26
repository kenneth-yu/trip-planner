import { redirect } from "next/navigation";
import { currentUser } from "@/server/auth/session";
import { appUrl, requestContext } from "@/server/app-context";
import { encryptSecret } from "@/server/auth/tokens";
import * as t from "@/server/db/schema";
import { exchangeCode, googleOAuthConfig, openState } from "@/server/google/oauth";
import { MIRROR_SCOPE } from "@/server/google/calendar-api";
import { enableMirror } from "@/server/services/mirror-service";

export async function GET(request: Request) {
  const user = await currentUser();
  if (!user) redirect("/");
  const url = new URL(request.url);
  const state = openState(url.searchParams.get("state"), user.id);
  const code = url.searchParams.get("code");
  const cfg = googleOAuthConfig(appUrl());
  if (!state || !code || !cfg) return new Response("That Google sign in did not finish. Go back and try connecting again.", { status: 400 });
  const tokens = await exchangeCode(cfg, code);
  if (!tokens.scope.split(" ").includes(MIRROR_SCOPE)) {
    return new Response("Google calendar access was not granted. Connect again and allow it.", { status: 400 });
  }
  const ctx = await requestContext();
  const row = { userId: user.id, refreshTokenEnc: encryptSecret(tokens.refreshToken), scope: tokens.scope, googleEmail: tokens.email ?? null };
  await ctx.db.insert(t.googleConnections).values(row).onConflictDoUpdate({ target: t.googleConnections.userId, set: row });
  await enableMirror(ctx, state.tripId, user.id);
  redirect(`/trips/${state.tripId}/connect`);
}
