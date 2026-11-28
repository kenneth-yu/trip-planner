import { z } from "zod";
import { currentUser } from "@/server/auth/session";
import { requestContext } from "@/server/app-context";
import { MAX_ICS_BYTES } from "@/domain/import/ics";
import { importIcsText, importIcsUrl } from "@/server/import/ics-import";
import { NOT_ON_ACCOUNT_PATH } from "@/server/web";
import { NotFound } from "@/server/services/trip-service";
import { AccessDenied } from "@/domain/visibility/project";
import type { Requester } from "@/domain/types";
import { problemFor, type ProblemCode } from "./problems";

export const dynamic = "force-dynamic";

const MAX_BODY_BYTES = MAX_ICS_BYTES + 64 * 1024;
const TripId = z.string().uuid();

async function readCapped(request: Request, maxBytes: number): Promise<Uint8Array<ArrayBuffer> | null> {
  const reader = request.body?.getReader();
  if (!reader) return new Uint8Array(0);
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

async function readForm(request: Request): Promise<FormData | "too_big" | "unreadable"> {
  const bytes = await readCapped(request, MAX_BODY_BYTES);
  if (bytes === null) return "too_big";
  try {
    return await new Response(bytes, { headers: { "content-type": request.headers.get("content-type") ?? "" } }).formData();
  } catch (e) {
    if (e instanceof TypeError) return "unreadable";
    throw e;
  }
}

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
  const form = await readForm(request);
  if (form === "too_big") return problem(tripId, "too_big");
  if (form === "unreadable") return problem(tripId, "no_file");
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
    if (file.size > MAX_ICS_BYTES) return problem(tripId, "too_big");
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
