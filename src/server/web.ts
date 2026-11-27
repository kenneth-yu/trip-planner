import { notFound, redirect } from "next/navigation";
import { currentUser } from "./auth/session";
import { requestContext } from "./app-context";
import { getTripView, NotFound } from "./services/trip-service";
import { AccessDenied } from "@/domain/visibility/project";
import { signInPath } from "@/domain/auth/next-path";
import type { Requester } from "@/domain/types";

export async function requireUser(next = "/") {
  const user = await currentUser();
  if (!user) redirect(signInPath(next));
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
    if (e instanceof NotFound || e instanceof AccessDenied) notFound();
    throw e;
  }
}
