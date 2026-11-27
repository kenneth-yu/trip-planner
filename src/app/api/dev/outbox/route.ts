import { z } from "zod";
import { devOutbox } from "@/server/auth/email";
import { devSignInEnabled } from "@/server/auth/session";

const query = z.object({ to: z.email() });

export async function GET(request: Request) {
  if (!devSignInEnabled()) return new Response("Not found", { status: 404 });
  const parsed = query.safeParse({ to: new URL(request.url).searchParams.get("to") });
  if (!parsed.success) return new Response("Missing address", { status: 400 });
  const link = devOutbox().lastLink(parsed.data.to);
  if (!link) return new Response("Not found", { status: 404 });
  return Response.json({ url: link });
}
