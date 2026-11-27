import { z } from "zod";
import { safeNextPath } from "@/domain/auth/next-path";
import { devSignInEnabled, startDevSession } from "@/server/auth/session";
import { USERS } from "@/fixtures/december-trip";

const query = z.object({ as: z.enum(["kenny", "jacob"]), next: z.string().optional() });

export async function GET(request: Request) {
  if (!devSignInEnabled()) return new Response("Not found", { status: 404 });
  const params = new URL(request.url).searchParams;
  const parsed = query.safeParse({ as: params.get("as"), next: params.get("next") ?? undefined });
  if (!parsed.success) return new Response("Unknown user", { status: 400 });
  const started = await startDevSession(USERS[parsed.data.as].id);
  if (!started) return new Response("That demo account is not in the database. Run npm run db:seed.", { status: 409 });
  return new Response(null, { status: 303, headers: { Location: safeNextPath(parsed.data.next) } });
}
