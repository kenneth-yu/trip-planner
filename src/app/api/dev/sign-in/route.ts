import { redirect } from "next/navigation";
import { z } from "zod";
import { devSignInEnabled, startSession } from "@/server/auth/session";
import { USERS } from "@/fixtures/december-trip";

export async function GET(request: Request) {
  if (!devSignInEnabled()) return new Response("Not found", { status: 404 });
  const key = z.enum(["kenny", "jacob"]).safeParse(new URL(request.url).searchParams.get("as"));
  if (!key.success) return new Response("Unknown user", { status: 400 });
  const user = USERS[key.data];
  await startSession(user.id);
  redirect("/");
}
