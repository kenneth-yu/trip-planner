import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { currentUser } from "./auth/session";
import { requestContext } from "./app-context";
import { getTripView, NotFound } from "./services/trip-service";
import { AccessDenied } from "@/domain/visibility/project";
import { safeNextPath, signInPath } from "@/domain/auth/next-path";
import { REQUEST_PATH_HEADER } from "./security/request-path";
import { loadViewLinkTrip } from "./services/view-link-service";
import { FALLBACK_ZONE } from "@/domain/time/zone-hint";
import type { Requester } from "@/domain/types";

export const NOT_ON_ACCOUNT_PATH = "/not-on-your-account";

async function pathToReturnTo(fallback: string): Promise<string> {
  const header = (await headers()).get(REQUEST_PATH_HEADER);
  const fromRequest = header ? safeNextPath(header) : "/";
  return fromRequest === "/" ? safeNextPath(fallback) : fromRequest;
}

export async function requireUser(next = "/") {
  const user = await currentUser();
  if (!user) redirect(signInPath(await pathToReturnTo(next)));
  return user;
}

export async function loadTripPage(tripId: string, next = `/trips/${tripId}`) {
  const user = await requireUser(next);
  const ctx = await requestContext();
  const requester: Requester = { kind: "member", userId: user.id, homeZone: user.homeZone };
  try {
    const view = await getTripView(ctx, tripId, requester);
    return { ctx, user, requester, view };
  } catch (e) {
    if (e instanceof NotFound || e instanceof AccessDenied) redirect(NOT_ON_ACCOUNT_PATH);
    throw e;
  }
}

export async function loadLinkPage(token: string, zoneHint: string | null) {
  const ctx = await requestContext();
  const view = await loadViewLinkTrip(ctx, token, zoneHint ?? FALLBACK_ZONE);
  return view ? { ctx, view, zoneKnown: zoneHint !== null } : null;
}
