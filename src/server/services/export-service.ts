import { asc, eq } from "drizzle-orm";
import * as t from "../db/schema";
import type { ServiceContext } from "./context";
import { NotFound, requireAggregate } from "./trip-service";
import { projectTrip, type VisibleItem } from "@/domain/visibility/project";
import type { ItemPrivate, Money, Role, ZonedTime } from "@/domain/types";

export interface ExportedPrivate {
  traveler: string | null;
  confirmationCode?: string;
  bookingReference?: string;
  seat?: string;
  phone?: string;
  price?: Money;
  notes?: string;
  bookingSite?: string;
}

export interface ExportedDeadline {
  kind: string;
  at: ZonedTime;
  consequence: string;
}

export interface ExportedItem {
  type: string;
  title: string;
  start: ZonedTime;
  end: ZonedTime;
  startIsEstimated: boolean;
  endIsEstimated: boolean;
  location: VisibleItem["location"];
  flight?: VisibleItem["flight"];
  stay?: VisibleItem["stay"];
  transfer?: VisibleItem["transfer"];
  travelers: string[];
  status: string;
  notes: string;
  deadlines: ExportedDeadline[];
  private: ExportedPrivate[];
}

export interface ExportedTrip {
  name: string;
  role: Role;
  travelers: string[];
  items: ExportedItem[];
}

export interface UserExport {
  exportedAt: string;
  you: { name: string; email: string };
  trips: ExportedTrip[];
}

export function exportFileName(now: Date): string {
  return `trip-planner-export-${now.toISOString().slice(0, 10)}.json`;
}

function exportedPrivate(row: ItemPrivate, travelerNames: Map<string, string>): ExportedPrivate {
  const { travelerId, ...fields } = row;
  return { traveler: travelerId ? (travelerNames.get(travelerId) ?? null) : null, ...fields };
}

function exportedItem(item: VisibleItem, travelerNames: Map<string, string>): ExportedItem {
  return {
    type: item.type,
    title: item.title,
    start: item.start,
    end: item.end,
    startIsEstimated: item.startIsEstimated,
    endIsEstimated: item.endIsEstimated,
    location: item.location,
    flight: item.flight,
    stay: item.stay,
    transfer: item.transfer,
    travelers: item.travelerIds.flatMap((id) => travelerNames.get(id) ?? []),
    status: item.status,
    notes: item.notes,
    deadlines: item.deadlines.map((d) => ({ kind: d.kind, at: d.at, consequence: d.consequence })),
    private: item.private.map((p) => exportedPrivate(p, travelerNames)),
  };
}

export async function exportUserData(ctx: ServiceContext, userId: string): Promise<UserExport> {
  const [user] = await ctx.db.select({ name: t.users.name, email: t.users.email, homeZone: t.users.homeZone }).from(t.users).where(eq(t.users.id, userId));
  if (!user) throw new NotFound("That account does not exist.");
  const memberships = await ctx.db
    .select({ tripId: t.memberships.tripId })
    .from(t.memberships)
    .innerJoin(t.trips, eq(t.trips.id, t.memberships.tripId))
    .where(eq(t.memberships.userId, userId))
    .orderBy(asc(t.trips.createdAt), asc(t.trips.id));
  const trips: ExportedTrip[] = [];
  for (const { tripId } of memberships) {
    const agg = await requireAggregate(ctx.db, tripId);
    const view = projectTrip(agg, { kind: "member", userId, homeZone: user.homeZone });
    const names = new Map(view.travelers.map((x) => [x.id, x.name]));
    trips.push({
      name: view.trip.name,
      role: view.permissions.role === "link" ? "viewer" : view.permissions.role,
      travelers: view.travelers.map((x) => x.name),
      items: view.items.map((i) => exportedItem(i, names)),
    });
  }
  return { exportedAt: ctx.now().toISOString(), you: { name: user.name, email: user.email }, trips };
}
