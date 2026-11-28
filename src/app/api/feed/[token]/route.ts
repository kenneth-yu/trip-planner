import { requestContext } from "@/server/app-context";
import { loadFeed } from "@/server/services/feed-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NOT_FOUND = () => new Response(null, { status: 404, headers: { "cache-control": "private, no-store" } });

export async function GET(_request: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const feed = await loadFeed(await requestContext(), token.replace(/\.ics$/, ""));
  if (feed === null) return NOT_FOUND();
  return new Response(feed, {
    status: 200,
    headers: {
      "content-type": "text/calendar; charset=utf-8",
      "cache-control": "private, max-age=0, must-revalidate",
      "x-content-type-options": "nosniff",
    },
  });
}
