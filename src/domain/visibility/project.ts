import { whereAt } from "../time/days";
import type { Deadline, Item, ItemPrivate, Requester, Role, TripAggregate, Traveler, ZonedTime } from "../types";

export interface VisibleDeadline extends Omit<Deadline, "confirmedBy"> {
  confirmed: boolean;
}

export interface VisibleItem extends Omit<Item, "private" | "deadlines" | "visibleToUserIds" | "createdBy" | "updatedBy"> {
  private: ItemPrivate[];
  deadlines: VisibleDeadline[];
  createdBy: string | null;
  updatedBy: string | null;
  visibleToUserIds: string[];
}

export interface BusyBlock {
  key: string;
  start: ZonedTime;
  end: ZonedTime;
}

export interface Permissions {
  role: Role | "link";
  canEdit: boolean;
  canSeeSensitive: boolean;
  canSeeDeadlines: boolean;
  canManageSharing: boolean;
}

export interface TripView {
  trip: { id: string; name: string; viewersSeeDeadlines?: boolean };
  travelers: Pick<Traveler, "id" | "name">[];
  items: VisibleItem[];
  busy: BusyBlock[];
  permissions: Permissions;
  homeZone: string;
  viewerUserId: string | null;
}

export class AccessDenied extends Error {
  constructor(message = "You do not have access to this trip.") {
    super(message);
    this.name = "AccessDenied";
  }
}

export function permissionsFor(agg: TripAggregate, requester: Requester): Permissions {
  if (requester.kind === "link") {
    if (!agg.shareLink?.enabled) throw new AccessDenied("That link has been turned off. Ask the trip owner for a new one.");
    return {
      role: "link",
      canEdit: false,
      canSeeSensitive: false,
      canSeeDeadlines: agg.shareLink.showsDeadlines,
      canManageSharing: false,
    };
  }
  const membership = agg.memberships.find((m) => m.userId === requester.userId);
  if (!membership) throw new AccessDenied();
  const role = membership.role;
  const isEditor = role === "owner" || role === "editor";
  return {
    role,
    canEdit: isEditor,
    canSeeSensitive: isEditor,
    canSeeDeadlines: isEditor || agg.trip.viewersSeeDeadlines,
    canManageSharing: role === "owner",
  };
}

export function canSeeItem(item: Item, requester: Requester): boolean {
  if (item.visibility === "everyone") return true;
  if (requester.kind === "link") return false;
  if (item.createdBy === requester.userId) return true;
  return item.visibility === "specific" && item.visibleToUserIds.includes(requester.userId);
}

function projectItem(item: Item, requester: Requester, perms: Permissions): VisibleItem {
  const isMember = requester.kind === "member";
  const isCreator = isMember && item.createdBy === requester.userId;
  return {
    id: item.id,
    tripId: item.tripId,
    type: item.type,
    title: item.title,
    start: { ...item.start },
    end: { ...item.end },
    startIsEstimated: item.startIsEstimated,
    endIsEstimated: item.endIsEstimated,
    location: item.location ? { ...item.location } : null,
    flight: item.flight ? { ...item.flight } : undefined,
    stay: item.stay ? { ...item.stay } : undefined,
    transfer: item.transfer ? structuredClone(item.transfer) : undefined,
    travelerIds: [...item.travelerIds],
    visibility: item.visibility,
    visibleToUserIds: isCreator ? [...item.visibleToUserIds] : [],
    showAsBusy: item.showAsBusy,
    status: item.status,
    flags: requester.kind === "link" ? [] : [...item.flags],
    notes: perms.canSeeSensitive ? item.notes : "",
    private: perms.canSeeSensitive ? item.private.map((p) => structuredClone(p)) : [],
    deadlines: perms.canSeeDeadlines ? item.deadlines.map(({ confirmedBy, ...d }) => ({ ...structuredClone(d), confirmed: confirmedBy !== null })) : [],
    createdBy: isMember ? item.createdBy : null,
    updatedBy: isMember ? item.updatedBy : null,
    createdAt: item.createdAt,
    updatedAt: item.updatedAt,
  };
}

function mergeBusy(hidden: Item[], visible: VisibleItem[], homeZone: string): BusyBlock[] {
  const spans = hidden.map((i) => ({ start: Date.parse(i.start.at), end: Date.parse(i.end.at) })).sort((a, b) => a.start - b.start || a.end - b.end);
  const merged: { start: number; end: number }[] = [];
  for (const span of spans) {
    const last = merged[merged.length - 1];
    if (last && span.start <= last.end) last.end = Math.max(last.end, span.end);
    else merged.push({ ...span });
  }
  const zoneAt = (ms: number) => whereAt(ms, visible, homeZone).zone;
  return merged.map((m) => {
    const start = new Date(m.start).toISOString();
    const end = new Date(m.end).toISOString();
    return { key: `busy-${start}-${end}`, start: { at: start, zone: zoneAt(m.start) }, end: { at: end, zone: zoneAt(m.end) } };
  });
}

export function projectTrip(agg: TripAggregate, requester: Requester): TripView {
  const permissions = permissionsFor(agg, requester);
  const items: VisibleItem[] = [];
  const hiddenBusy: Item[] = [];
  const sorted = [...agg.items].sort((a, b) => a.start.at.localeCompare(b.start.at));
  for (const item of sorted) {
    if (canSeeItem(item, requester)) items.push(projectItem(item, requester, permissions));
    else if (item.showAsBusy) hiddenBusy.push(item);
  }
  const busy = requester.kind === "link" ? [] : mergeBusy(hiddenBusy, items, requester.homeZone);
  return {
    trip: {
      id: agg.trip.id,
      name: agg.trip.name,
      ...(permissions.canManageSharing ? { viewersSeeDeadlines: agg.trip.viewersSeeDeadlines } : {}),
    },
    travelers: agg.travelers.map((t) => ({ id: t.id, name: t.name })),
    items,
    busy,
    permissions,
    homeZone: requester.homeZone,
    viewerUserId: requester.kind === "member" ? requester.userId : null,
  };
}

export function assertCanEditItem(agg: TripAggregate, requester: Requester, item: Item): void {
  const perms = permissionsFor(agg, requester);
  if (!perms.canEdit || !canSeeItem(item, requester)) throw new AccessDenied("You cannot change this item.");
}

export function assertCanEditTrip(agg: TripAggregate, requester: Requester): void {
  if (!permissionsFor(agg, requester).canEdit) throw new AccessDenied("You cannot change this trip.");
}
