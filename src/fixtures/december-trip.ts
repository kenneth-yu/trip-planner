import raw from "./december-trip.json";
import { fromLocal } from "../domain/time/format";
import { airportZone } from "../domain/time/places";
import { z } from "zod";
import type { Deadline, Item, ItemPrivate, TripAggregate } from "../domain/types";

export const fixture = raw;
export const FIXTURE_TODAY = raw.today;

export function fixtureUuid(group: number, n: number): string {
  return `00000000-0000-4000-8${group}00-${String(n).padStart(12, "0")}`;
}

export const USERS = {
  kenny: { id: fixtureUuid(1, 1), name: "Kenneth Yu", email: "kenny@example.com", homeZone: "America/New_York" },
  jacob: { id: fixtureUuid(1, 2), name: "Jacob Feldman", email: "jacob@example.com", homeZone: "America/New_York" },
} as const;

export const TRAVELERS = { kenny: fixtureUuid(2, 1), jacob: fixtureUuid(2, 2) } as const;
export const TRIP_ID = fixtureUuid(3, 1);


export function itemId(i: number): string {
  return fixtureUuid(4, i + 1);
}

const TravelerKey = z.enum(["kenny", "jacob"]);
const LocalTime = z.object({ local: z.string(), zone: z.string(), estimated: z.boolean().optional() });
const Common = {
  start: LocalTime,
  end: LocalTime,
  travelers: z.array(TravelerKey),
  status: z.enum(["confirmed", "needs_review"]).optional(),
  deadlines: z
    .array(z.object({ kind: z.enum(["free_cancellation", "partial_refund", "change", "other"]), local: z.string(), zone: z.string(), consequence: z.string() }))
    .optional(),
};
const FixtureItem = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("flight"),
    flightNumber: z.string(),
    airline: z.string(),
    from: z.string(),
    to: z.string(),
    private: z.array(z.object({ traveler: TravelerKey, seat: z.string().optional(), confirmationCode: z.string().optional() })).optional(),
    ...Common,
  }),
  z.object({ type: z.literal("stay"), title: z.string(), city: z.string().nullable(), lateArrivalCutoff: z.string().optional(), ...Common }),
  z.object({ type: z.literal("plan"), title: z.string(), city: z.string().nullable(), ...Common }),
]);
type FixtureItem = z.infer<typeof FixtureItem>;

function zoneOfAirport(code: string): string {
  const zone = airportZone(code);
  if (!zone) throw new Error(`Fixture airport ${code} is not in the airport dataset`);
  return zone;
}

function toItem(raw: unknown, i: number): Item {
  const f: FixtureItem = FixtureItem.parse(raw);
  const id = itemId(i);
  const now = "2026-11-20T12:00:00.000Z";
  const startZone = f.type === "flight" ? zoneOfAirport(f.from) : f.start.zone;
  const endZone = f.type === "flight" ? zoneOfAirport(f.to) : f.end.zone;
  const title = f.type === "flight" ? f.flightNumber : f.title;
  const privates: ItemPrivate[] =
    f.type === "flight" ? (f.private ?? []).map((p) => ({ travelerId: TRAVELERS[p.traveler], seat: p.seat, confirmationCode: p.confirmationCode })) : [];
  const deadlines: Deadline[] = (f.deadlines ?? []).map((d, j) => ({
    id: fixtureUuid(5, (i + 1) * 10 + j),
    itemId: id,
    kind: d.kind,
    at: fromLocal(d.local, d.zone),
    consequence: d.consequence,
    source: "manual",
    confirmedBy: USERS.kenny.id,
  }));
  return {
    id,
    tripId: TRIP_ID,
    type: f.type,
    title,
    start: fromLocal(f.start.local, startZone),
    end: fromLocal(f.end.local, endZone),
    startIsEstimated: Boolean(f.start.estimated),
    endIsEstimated: Boolean(f.end.estimated),
    location: f.type === "flight" ? null : { name: title, city: f.city ?? undefined },
    flight: f.type === "flight" ? { flightNumber: f.flightNumber, airline: f.airline, fromAirport: f.from, toAirport: f.to } : undefined,
    stay:
      f.type === "stay"
        ? { propertyName: title, kind: /airbnb/i.test(title) ? "rental" : /hotel/i.test(title) ? "hotel" : "other", lateArrivalCutoff: f.lateArrivalCutoff }
        : undefined,
    travelerIds: f.travelers.map((t) => TRAVELERS[t]),
    visibility: "everyone",
    visibleToUserIds: [],
    showAsBusy: false,
    status: f.status ?? "confirmed",
    notes: "",
    private: privates,
    deadlines,
    createdBy: USERS.kenny.id,
    updatedBy: USERS.kenny.id,
    createdAt: now,
    updatedAt: now,
  };
}

export function buildFixtureTrip(): TripAggregate {
  return {
    trip: {
      id: TRIP_ID,
      name: raw.trip.name,
      ownerId: USERS.kenny.id,
      viewersSeeDeadlines: false,
      createdAt: "2026-11-01T00:00:00.000Z",
      updatedAt: "2026-11-20T00:00:00.000Z",
    },
    memberships: [
      { tripId: TRIP_ID, userId: USERS.kenny.id, role: "owner" },
      { tripId: TRIP_ID, userId: USERS.jacob.id, role: "editor" },
    ],
    travelers: [
      { id: TRAVELERS.kenny, tripId: TRIP_ID, name: USERS.kenny.name, userId: USERS.kenny.id },
      { id: TRAVELERS.jacob, tripId: TRIP_ID, name: USERS.jacob.name, userId: USERS.jacob.id },
    ],
    items: raw.expected.items.map(toItem),
    shareLink: { enabled: true, showsDeadlines: false },
  };
}

export function fixtureItem(trip: TripAggregate, match: (i: Item) => boolean): Item {
  const found = trip.items.find(match);
  if (!found) throw new Error("Fixture item not found");
  return found;
}

export const byFlight = (n: string) => (i: Item) => i.flight?.flightNumber === n;
export const byTitle = (t: string) => (i: Item) => i.title.startsWith(t);
