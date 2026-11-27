import fc from "fast-check";
import { fixtureUuid } from "@/fixtures/december-trip";
import { airportZone } from "@/domain/time/places";
import { present } from "./present";
import type { Deadline, Item, ItemPrivate, ItemType, Membership, Requester, Role, Traveler, TripAggregate, Visibility, ZonedTime } from "@/domain/types";

export const TRIP_ID = fixtureUuid(3, 9);

export const AIRPORTS = ["JFK", "HND", "NRT", "HKG", "SZX", "LHR", "AKL", "LAX", "SYD", "HNL", "APW", "PPG", "KIX", "CHC"] as const;
export const CITIES = ["New York", "Tokyo", "Hong Kong", "London", "Auckland", "Osaka", "Shenzhen", "Los Angeles"] as const;
export const PLAN_ZONES = [
  "America/New_York",
  "Asia/Tokyo",
  "Asia/Hong_Kong",
  "Europe/London",
  "Pacific/Auckland",
  "Pacific/Kiritimati",
  "Pacific/Pago_Pago",
  "Asia/Kolkata",
  "Asia/Kathmandu",
  "Australia/Adelaide",
  "Pacific/Chatham",
] as const;
export const DST_ZONES = ["America/New_York", "Europe/London", "Pacific/Auckland", "Australia/Adelaide", "Pacific/Chatham", "America/St_Johns"] as const;
export const DATE_LINE_ZONES = ["Pacific/Auckland", "Pacific/Kiritimati", "Pacific/Pago_Pago", "Pacific/Chatham", "Pacific/Apia"] as const;
export const HALF_HOUR_ZONES = ["Asia/Kolkata", "Asia/Kathmandu", "Australia/Adelaide", "Pacific/Chatham", "America/St_Johns", "Asia/Tehran"] as const;

const RANGE_START = Date.UTC(2026, 10, 25);
const RANGE_END = Date.UTC(2027, 1, 1);
const MINUTE = 60_000;

export const instantMsArb = fc.integer({ min: RANGE_START / MINUTE, max: RANGE_END / MINUTE }).map((m) => m * MINUTE);
export const isoOf = (ms: number): string => new Date(ms).toISOString();
const pad = (n: number, width = 3): string => String(n).padStart(width, "0");

export const itemMarkers = (index: number) => ({
  id: fixtureUuid(4, index + 1),
  title: `ttl${pad(index)}x`,
  flightNumber: `fn${pad(index)}x`,
  propertyName: `prop${pad(index)}x`,
  placeName: `plc${pad(index)}x`,
  address: `adr${pad(index)}x`,
  notes: `note${pad(index)}x`,
  consequence: (d: number) => `cons${pad(index)}${d}x`,
  deadlineId: (d: number) => fixtureUuid(5, (index + 1) * 10 + d),
  sensitive: (p: number) => ({
    confirmationCode: `code${pad(index)}${p}x`,
    bookingReference: `ref${pad(index)}${p}x`,
    seat: `seat${pad(index)}${p}x`,
    phone: `+000${pad(index)}${p}0000x`,
    amount: `${pad(index, 4)}${p}.77`,
    bookingSite: `site${pad(index)}${p}x`,
  }),
});

interface PrivateSpec {
  traveler: number | null;
  fields: [boolean, boolean, boolean, boolean, boolean, boolean];
}

interface DeadlineSpec {
  kind: Deadline["kind"];
  atMs: number;
  zone: string;
  source: Deadline["source"];
  confirmed: boolean;
}

interface ItemSpec {
  type: ItemType;
  startMs: number;
  durationMin: number;
  zone: string;
  fromAirport: string;
  toAirport: string;
  city: string;
  startEstimated: boolean;
  endEstimated: boolean;
  visibility: Visibility;
  visibleTo: number[];
  creator: number;
  showAsBusy: boolean;
  confirmed: boolean;
  travelers: number[];
  privates: PrivateSpec[];
  deadlines: DeadlineSpec[];
  withLocation: boolean;
  withAddress: boolean;
}

const privateSpec: fc.Arbitrary<PrivateSpec> = fc.record({
  traveler: fc.option(fc.nat(3), { nil: null }),
  fields: fc.tuple(fc.boolean(), fc.boolean(), fc.boolean(), fc.boolean(), fc.boolean(), fc.boolean()),
});

const deadlineSpec: fc.Arbitrary<DeadlineSpec> = fc.record({
  kind: fc.constantFrom("free_cancellation", "partial_refund", "change", "other"),
  atMs: instantMsArb,
  zone: fc.constantFrom(...PLAN_ZONES),
  source: fc.constantFrom("manual", "parsed"),
  confirmed: fc.boolean(),
});

const itemSpec: fc.Arbitrary<ItemSpec> = fc.record({
  type: fc.constantFrom("flight", "stay", "plan", "transfer"),
  startMs: fc.oneof({ weight: 1, arbitrary: instantMsArb }, { weight: 3, arbitrary: fc.constantFrom(RANGE_START + 86_400_000, RANGE_START + 2 * 86_400_000) }),
  durationMin: fc.oneof({ weight: 1, arbitrary: fc.integer({ min: 1, max: 20 * 60 }) }, { weight: 3, arbitrary: fc.constantFrom(60, 120) }),
  zone: fc.constantFrom(...PLAN_ZONES),
  fromAirport: fc.constantFrom(...AIRPORTS),
  toAirport: fc.constantFrom(...AIRPORTS),
  city: fc.constantFrom(...CITIES),
  startEstimated: fc.boolean(),
  endEstimated: fc.boolean(),
  visibility: fc.constantFrom("everyone", "everyone", "only_me", "specific"),
  visibleTo: fc.array(fc.nat(3), { maxLength: 3 }),
  creator: fc.nat(3),
  showAsBusy: fc.boolean(),
  confirmed: fc.boolean(),
  travelers: fc.array(fc.nat(3), { maxLength: 3 }),
  privates: fc.array(privateSpec, { maxLength: 3 }),
  deadlines: fc.array(deadlineSpec, { maxLength: 2 }),
  withLocation: fc.boolean(),
  withAddress: fc.boolean(),
});

export interface ItemContext {
  tripId: string;
  userIds: string[];
  travelerIds: string[];
}

function pick<T>(list: readonly T[], i: number): T {
  return present(list[i % list.length]);
}

function zoneOfAirport(code: string): string {
  return present(airportZone(code), `zone of airport ${code}`);
}

function buildItem(spec: ItemSpec, index: number, ctx: ItemContext): Item {
  const m = itemMarkers(index);
  const zonedAt = (ms: number, zone: string): ZonedTime => ({ at: isoOf(ms), zone });
  const isFlight = spec.type === "flight";
  const startZone = isFlight ? zoneOfAirport(spec.fromAirport) : spec.zone;
  const endZone = isFlight ? zoneOfAirport(spec.toAirport) : spec.zone;
  const endMs = spec.startMs + spec.durationMin * MINUTE;
  const creator = pick(ctx.userIds, spec.creator);
  const privates: ItemPrivate[] = spec.privates.map((p, pi) => {
    const s = m.sensitive(pi);
    const f = p.fields;
    return {
      travelerId: p.traveler === null || !ctx.travelerIds.length ? null : pick(ctx.travelerIds, p.traveler),
      ...(f[0] ? { confirmationCode: s.confirmationCode } : {}),
      ...(f[1] ? { bookingReference: s.bookingReference } : {}),
      ...(f[2] ? { seat: s.seat } : {}),
      ...(f[3] ? { phone: s.phone } : {}),
      ...(f[4] ? { price: { amount: s.amount, currency: "USD" } } : {}),
      ...(f[5] ? { bookingSite: s.bookingSite } : {}),
    };
  });
  const deadlines: Deadline[] = spec.deadlines.map((d, di) => ({
    id: m.deadlineId(di),
    itemId: m.id,
    kind: d.kind,
    at: zonedAt(d.atMs, d.zone),
    consequence: m.consequence(di),
    source: d.source,
    confirmedBy: d.confirmed ? creator : null,
  }));
  return {
    id: m.id,
    tripId: ctx.tripId,
    type: spec.type,
    title: m.title,
    start: zonedAt(spec.startMs, startZone),
    end: zonedAt(endMs, endZone),
    startIsEstimated: spec.startEstimated,
    endIsEstimated: spec.endEstimated,
    location: isFlight ? null : { ...(spec.withLocation ? { name: m.placeName } : {}), city: spec.city, ...(spec.withAddress ? { address: m.address } : {}) },
    flight: isFlight ? { flightNumber: m.flightNumber, airline: "Test Air", fromAirport: spec.fromAirport, toAirport: spec.toAirport } : undefined,
    stay: spec.type === "stay" ? { propertyName: m.propertyName, kind: "hotel" } : undefined,
    transfer: spec.type === "transfer" ? { mode: "train", fromPlace: { city: spec.city }, toPlace: { city: pick(CITIES, spec.creator + 1) } } : undefined,
    travelerIds: ctx.travelerIds.length ? [...new Set(spec.travelers.map((t) => pick(ctx.travelerIds, t)))] : [],
    visibility: spec.visibility,
    visibleToUserIds: spec.visibility === "specific" ? [...new Set(spec.visibleTo.map((u) => pick(ctx.userIds, u)))] : [],
    showAsBusy: spec.showAsBusy,
    status: spec.confirmed ? "confirmed" : "needs_review",
    notes: m.notes,
    flags: [],
    private: privates,
    deadlines,
    createdBy: creator,
    updatedBy: creator,
    createdAt: "2026-11-20T12:00:00.000Z",
    updatedAt: "2026-11-21T12:00:00.000Z",
  };
}

export function itemsFor(ctx: ItemContext, maxItems = 8): fc.Arbitrary<Item[]> {
  return fc.array(itemSpec, { maxLength: maxItems }).map((specs) => specs.map((s, i) => buildItem(s, i, ctx)));
}

export const memberUserId = (j: number): string => fixtureUuid(1, j + 1);
export const travelerIdOf = (j: number): string => fixtureUuid(2, j + 1);
export const OUTSIDER_ID = memberUserId(9);

export type RequesterKind = "member" | "link" | "outsider";

export interface Scenario {
  agg: TripAggregate;
  requester: Requester;
  kind: RequesterKind;
}

const roleArb: fc.Arbitrary<Role> = fc.constantFrom("owner", "editor", "viewer");

export const scenario: fc.Arbitrary<Scenario> = fc
  .record({
    roles: fc.array(roleArb, { minLength: 0, maxLength: 3 }),
    travelerCount: fc.integer({ min: 1, max: 4 }),
    viewersSeeDeadlines: fc.boolean(),
    shareLink: fc.option(fc.record({ enabled: fc.boolean(), showsDeadlines: fc.boolean() }), { nil: null }),
    homeZone: fc.constantFrom(...PLAN_ZONES),
    requesterPick: fc.nat(5),
    requesterKind: fc.constantFrom<RequesterKind>("member", "member", "link", "outsider"),
  })
  .chain((base) => {
    const memberCount = base.roles.length + 1;
    const userIds = Array.from({ length: memberCount }, (_, j) => memberUserId(j));
    const travelerIds = Array.from({ length: base.travelerCount }, (_, j) => travelerIdOf(j));
    return itemsFor({ tripId: TRIP_ID, userIds, travelerIds }).map((items): Scenario => {
      const memberships: Membership[] = userIds.map((userId, j) => ({ tripId: TRIP_ID, userId, role: j === 0 ? "owner" : pick(base.roles, j - 1) }));
      const travelers: Traveler[] = travelerIds.map((id, j) => ({ id, tripId: TRIP_ID, name: `Traveler ${j + 1}`, userId: j < memberCount ? pick(userIds, j) : null }));
      const agg: TripAggregate = {
        trip: { id: TRIP_ID, name: "Property trip", ownerId: pick(userIds, 0), viewersSeeDeadlines: base.viewersSeeDeadlines, createdAt: "2026-11-01T00:00:00.000Z", updatedAt: "2026-11-01T00:00:00.000Z" },
        memberships,
        travelers,
        items,
        shareLink: base.shareLink,
      };
      if (base.requesterKind === "link") return { agg, requester: { kind: "link", homeZone: base.homeZone }, kind: "link" };
      if (base.requesterKind === "outsider") return { agg, requester: { kind: "member", userId: OUTSIDER_ID, homeZone: base.homeZone }, kind: "outsider" };
      return { agg, requester: { kind: "member", userId: pick(userIds, base.requesterPick), homeZone: base.homeZone }, kind: "member" };
    });
  });

export interface ItemMarkerSet {
  identifying: string[];
  sensitive: string[];
  deadlines: string[];
}

export function markersOf(item: Item): ItemMarkerSet {
  const index = Number(item.title.slice(3, 6));
  const m = itemMarkers(index);
  const identifying = [m.id, m.title, m.flightNumber, m.propertyName, m.placeName, m.address, m.notes];
  const sensitive = item.private.flatMap((_, p) => {
    const s = m.sensitive(p);
    return [s.confirmationCode, s.bookingReference, s.seat, s.phone, s.amount, s.bookingSite];
  });
  const deadlines = item.deadlines.flatMap((_, d) => [m.consequence(d), m.deadlineId(d)]);
  return { identifying, sensitive, deadlines };
}

export interface Oracle {
  allowed: boolean;
  canSeeSensitive: boolean;
  canSeeDeadlines: boolean;
  seesItem: (item: Item) => boolean;
}

export function oracleFor(agg: TripAggregate, requester: Requester): Oracle {
  if (requester.kind === "link") {
    const link = agg.shareLink;
    return {
      allowed: link?.enabled === true,
      canSeeSensitive: false,
      canSeeDeadlines: link?.showsDeadlines === true,
      seesItem: (item) => item.visibility === "everyone",
    };
  }
  const { userId } = requester;
  const role = agg.memberships.find((m) => m.userId === userId)?.role ?? null;
  const editor = role === "owner" || role === "editor";
  return {
    allowed: role !== null,
    canSeeSensitive: editor,
    canSeeDeadlines: editor || (role === "viewer" && agg.trip.viewersSeeDeadlines),
    seesItem: (item) => item.visibility === "everyone" || item.createdBy === userId || (item.visibility === "specific" && item.visibleToUserIds.includes(userId)),
  };
}

export function forbiddenStrings(agg: TripAggregate, requester: Requester): string[] {
  const oracle = oracleFor(agg, requester);
  const out: string[] = [];
  for (const item of agg.items) {
    const markers = markersOf(item);
    if (!oracle.seesItem(item)) out.push(...markers.identifying, ...markers.sensitive, ...markers.deadlines);
    else {
      if (!oracle.canSeeSensitive) out.push(...markers.sensitive);
      if (!oracle.canSeeDeadlines) out.push(...markers.deadlines);
    }
  }
  if (requester.kind === "link") {
    out.push(...agg.memberships.map((m) => m.userId), ...agg.travelers.flatMap((t) => (t.userId ? [t.userId] : [])));
  }
  return out;
}

export function fcParams(numRuns: number): fc.Parameters<unknown> {
  const fromEnv = process.env.FC_SEED ? Number(process.env.FC_SEED) : process.env.CI ? 20261126 : undefined;
  return { numRuns, ...(fromEnv === undefined ? {} : { seed: fromEnv }) };
}

export function expectedBusyIntervals(agg: TripAggregate, requester: Requester): [string, string][] {
  if (requester.kind === "link") return [];
  const oracle = oracleFor(agg, requester);
  const spans = agg.items
    .filter((i) => !oracle.seesItem(i) && i.showAsBusy)
    .map((i): [number, number] => [Date.parse(i.start.at), Date.parse(i.end.at)])
    .sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const merged: [number, number][] = [];
  for (const [start, end] of spans) {
    const last = merged[merged.length - 1];
    if (last && start <= last[1]) last[1] = Math.max(last[1], end);
    else merged.push([start, end]);
  }
  return merged.map(([start, end]) => [isoOf(start), isoOf(end)]);
}
