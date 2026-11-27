import { asc, eq } from "drizzle-orm";
import * as t from "../db/schema";
import type { ServiceContext } from "./context";
import { requireAggregate } from "./trip-service";
import { AccessDenied, permissionsFor } from "@/domain/visibility/project";
import type { Requester, Role } from "@/domain/types";

export interface TripMember {
  userId: string;
  name: string;
  role: Role;
}

export async function listTripMembers(ctx: ServiceContext, tripId: string, requester: Requester): Promise<TripMember[]> {
  if (requester.kind !== "member") throw new AccessDenied();
  const agg = await requireAggregate(ctx.db, tripId);
  permissionsFor(agg, requester);
  return ctx.db
    .select({ userId: t.users.id, name: t.users.name, role: t.memberships.role })
    .from(t.memberships)
    .innerJoin(t.users, eq(t.users.id, t.memberships.userId))
    .where(eq(t.memberships.tripId, tripId))
    .orderBy(asc(t.users.name));
}
