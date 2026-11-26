import { notFound, redirect } from "next/navigation";
import { currentUser } from "./auth/session";
import { requestContext } from "./app-context";
import { getTripView, NotFound } from "./services/trip-service";
import { AccessDenied } from "@/domain/visibility/project";
import type { Requester } from "@/domain/types";

export async function requireUser() {
  const user = await currentUser();
  if (!user) redirect("/");
  return user;
}

export async function loadTripPage(tripId: string) {
  const user = await requireUser();
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
