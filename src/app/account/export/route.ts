import { currentUser } from "@/server/auth/session";
import { requestContext } from "@/server/app-context";
import { consumeRateLimit, RATE_RULES } from "@/server/security/rate-limit";
import { exportFileName, exportUserData } from "@/server/services/export-service";

const PLAIN = { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" };

function fromThisSite(request: Request): boolean {
  const origin = request.headers.get("origin");
  const host = request.headers.get("host");
  if (!origin || !host) return false;
  return URL.parse(origin)?.host === host;
}

export async function POST(request: Request) {
  if (!fromThisSite(request)) return new Response("That request did not come from this site.", { status: 403, headers: PLAIN });
  const user = await currentUser();
  if (!user) return new Response("Sign in to download your data.", { status: 401, headers: PLAIN });
  const ctx = await requestContext();
  let verdict: { allowed: boolean; retryAfterS: number };
  try {
    verdict = await consumeRateLimit(ctx.db, RATE_RULES.dataExport, user.id, ctx.now());
  } catch (e) {
    console.error(`Rate limit unavailable for data export: ${e instanceof Error ? e.name : "unknown error"}`);
    return new Response("This is unavailable right now. Try again in a moment.", { status: 503, headers: { ...PLAIN, "retry-after": "30" } });
  }
  if (!verdict.allowed) return new Response("Too many downloads. Wait a few minutes and try again.", { status: 429, headers: { ...PLAIN, "retry-after": String(verdict.retryAfterS) } });
  const data = await exportUserData(ctx, user.id);
  return new Response(JSON.stringify(data, null, 2), {
    status: 200,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "content-disposition": `attachment; filename="${exportFileName(ctx.now())}"`,
      "cache-control": "no-store",
    },
  });
}
