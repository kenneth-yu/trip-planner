import { offlineHtml } from "./offline-html";

export function GET(request: Request) {
  return new Response(offlineHtml(request.headers.get("x-nonce")), {
    headers: { "content-type": "text/html; charset=utf-8" },
  });
}
