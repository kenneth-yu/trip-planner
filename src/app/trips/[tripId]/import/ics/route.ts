import { z } from "zod";
import { currentUser } from "@/server/auth/session";
import { requestContext } from "@/server/app-context";
import { MAX_ICS_CHARS } from "@/domain/import/ics";
import { importIcsText, importIcsUrl } from "@/server/import/ics-import";
import { NOT_ON_ACCOUNT_PATH } from "@/server/web";
import { NotFound } from "@/server/services/trip-service";
import { AccessDenied } from "@/domain/visibility/project";
import type { Requester } from "@/domain/types";
import { problemFor, type ProblemCode } from "./problems";

export const dynamic = "force-dynamic";

const MAX_BODY_BYTES = MAX_ICS_CHARS * 2 + 64 * 1024;
const TripId = z.string().uuid();

function redirectTo(path: string): Response {
  return new Response(null, { status: 303, headers: { Location: path } });
}

function sameSite(request: Request): boolean {
  const origin = request.headers.get("origin");
  if (origin === null) return request.headers.get("sec-fetch-site") !== "cross-site";
  const hosts = [request.headers.get("host"), request.headers.get("x-forwarded-host")].filter((h): h is string => h !== null);
  return URL.canParse(origin) && hosts.includes(new URL(origin).host);
}

function problem(tripId: string, code: ProblemCode): Response {
  return redirectTo(`/trips/${tripId}/import?problem=${code}`);
}

export async function POST(request: Request, { params }: { params: Promise<{ tripId: string }> }) {
  const parsedTrip = TripId.safeParse((await params).tripId);
  if (!parsedTrip.success) return new Response("Not found", { status: 404 });
  const tripId = parsedTrip.data;
  if (!sameSite(request)) return new Response("Forbidden", { status: 403 });
  const user = await currentUser();
  if (!user) return redirectTo(`/sign-in?next=${encodeURIComponent(`/trips/${tripId}/import`)}`);
  const length = Number(request.headers.get("content-length"));
  if (Number.isFinite(length) && length > MAX_BODY_BYTES) return problem(tripId, "too_big");
  const form = await request.formData();
  const ctx = await requestContext();
  const requester: Requester = { kind: "member", userId: user.id, homeZone: user.homeZone };
  const link = form.get("link");
  const file = form.get("file");
  try {
    if (typeof link === "string" && link.trim() !== "") {
      const outcome = await importIcsUrl(ctx, tripId, requester, link.trim());
      return redirectTo(`/trips/${tripId}/import?done=${outcome.count}&skipped=${outcome.skipped}&repeating=${outcome.repeating}`);
    }
    if (!(file instanceof File) || file.size === 0) return problem(tripId, "no_file");
    if (file.size > MAX_ICS_CHARS) return problem(tripId, "too_big");
    const outcome = await importIcsText(ctx, tripId, requester, await file.text(), "Calendar file");
    return redirectTo(`/trips/${tripId}/import?done=${outcome.count}&skipped=${outcome.skipped}&repeating=${outcome.repeating}`);
  } catch (e) {
    if (e instanceof NotFound || e instanceof AccessDenied) return redirectTo(NOT_ON_ACCOUNT_PATH);
    const code = problemFor(e);
    if (code) return problem(tripId, code);
    console.error("Calendar import failed", { tripId, error: e instanceof Error ? e.name : "unknown" });
    return problem(tripId, "try_again");
  }
}
