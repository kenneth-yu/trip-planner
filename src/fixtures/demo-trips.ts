import { inputToProposal, type ItemInput, type PlanItemInput } from "../domain/import/quick-add";
import type { Item, ItemStatus, TripAggregate, Visibility } from "../domain/types";
import { fixtureUuid, USERS } from "./december-trip";

type UserKey = keyof typeof USERS;

interface DemoItem {
  input: ItemInput;
  by?: UserKey;
  visibility?: Visibility;
  showAsBusy?: boolean;
  booked?: boolean;
  status?: ItemStatus;
}

export interface DemoTripSpec {
  index: number;
  name: string;
  travelers: string[];
  members: { user: UserKey; role: "owner" | "editor" | "viewer" }[];
  items: DemoItem[];
}

const everyone = ["Kenneth Yu", "Jacob Feldman", "Maya Chen", "Sam Ortiz"];

const tokyo = (title: string, start: string, end: string, extra: Partial<Omit<PlanItemInput, "type">> = {}): DemoItem => {
  const input: PlanItemInput = { type: "plan", title, city: "Tokyo", startLocal: start, endLocal: end, ...extra };
  return { input };
};

export const EMPTY_TRIP: DemoTripSpec = {
  index: 1,
  name: "Lisbon, someday",
  travelers: ["Kenneth Yu"],
  members: [{ user: "kenny", role: "owner" }],
  items: [],
};

export const SPARSE_TRIP: DemoTripSpec = {
  index: 2,
  name: "Chicago weekend",
  travelers: ["Kenneth Yu"],
  members: [{ user: "kenny", role: "owner" }],
  items: [
    { input: { type: "flight", flightNumber: "UA1531", airline: "United", fromAirport: "LGA", toAirport: "ORD", departLocal: "2027-04-16T17:00", arriveLocal: "2027-04-16T18:41" } },
    { input: { type: "stay", name: "Thompson Chicago", address: "21 E Bellevue Pl, Chicago, IL 60611", city: "Chicago", checkInDate: "2027-04-16", checkInTime: "16:00", checkOutDate: "2027-04-18", checkOutTime: "12:00" } },
    { input: { type: "flight", flightNumber: "UA2304", airline: "United", fromAirport: "ORD", toAirport: "LGA", departLocal: "2027-04-18T18:00", arriveLocal: "2027-04-18T21:10" } },
  ],
};

export const PACKED_TRIP: DemoTripSpec = {
  index: 3,
  name: "Tokyo and Kyoto with friends",
  travelers: everyone,
  members: [
    { user: "kenny", role: "owner" },
    { user: "jacob", role: "editor" },
  ],
  items: [
    { input: { type: "flight", flightNumber: "JL5", airline: "Japan Airlines", fromAirport: "JFK", toAirport: "HND", departLocal: "2027-03-07T13:25", arriveLocal: "2027-03-08T16:55", travelers: everyone } },
    { input: { type: "stay", name: "Hotel Gracery Shinjuku", address: "1-19-1 Kabukicho, Shinjuku-ku, Tokyo", city: "Tokyo", checkInDate: "2027-03-08", checkInTime: "15:00", checkOutDate: "2027-03-11", checkOutTime: "11:00", lateArrivalCutoff: "22:00" } },
    tokyo("Ichiran Shinjuku", "2027-03-08T19:30", "2027-03-08T20:30"),
    tokyo("Omoide Yokocho", "2027-03-08T21:00", "2027-03-08T22:30"),

    tokyo("Breakfast at Bills Omotesando", "2027-03-09T08:00", "2027-03-09T09:00"),
    tokyo("Meiji Jingu", "2027-03-09T09:30", "2027-03-09T10:30"),
    tokyo("teamLab Planets", "2027-03-09T11:00", "2027-03-09T13:00", { address: "6-1-16 Toyosu, Koto-ku, Tokyo" }),
    tokyo("Lunch at Toyosu Market", "2027-03-09T13:15", "2027-03-09T14:15"),
    tokyo("Ghibli Museum", "2027-03-09T15:00", "2027-03-09T17:00", { travelers: ["Maya", "Sam"] }),
    tokyo("Akihabara arcades", "2027-03-09T15:00", "2027-03-09T17:30", { travelers: ["Kenneth", "Jacob"] }),
    tokyo("Shibuya Sky at sunset", "2027-03-09T17:45", "2027-03-09T18:45"),
    tokyo("Dinner at Gonpachi", "2027-03-09T19:30", "2027-03-09T21:30"),
    tokyo("Golden Gai", "2027-03-09T22:00", "2027-03-09T23:59"),

    tokyo("Tsukiji outer market", "2027-03-10T07:30", "2027-03-10T09:00"),
    tokyo("Senso-ji", "2027-03-10T09:45", "2027-03-10T11:00"),
    tokyo("Sumida river cruise", "2027-03-10T11:15", "2027-03-10T12:00"),
    tokyo("Tonkatsu at Maisen", "2027-03-10T12:30", "2027-03-10T13:30"),
    { input: { type: "plan", title: "Ring shopping in Ginza", city: "Tokyo", startLocal: "2027-03-10T14:00", endLocal: "2027-03-10T15:30", travelers: ["Jacob"] }, by: "jacob", visibility: "only_me", showAsBusy: true },
    tokyo("Mori Art Museum", "2027-03-10T16:00", "2027-03-10T18:00"),
    tokyo("Sushi Saito", "2027-03-10T19:00", "2027-03-10T21:00", { confirmationCode: "SAITO-PLACEHOLDER", price: { amount: "120000", currency: "JPY" } }),

    { input: { type: "transfer", title: "Nozomi 17 to Kyoto", mode: "train", fromCity: "Tokyo", toCity: "Kyoto", country: "Japan", startLocal: "2027-03-11T09:00", endLocal: "2027-03-11T11:15" } },
    { input: { type: "stay", name: "Ace Hotel Kyoto", address: "245-2 Kurumayacho, Nakagyo-ku, Kyoto, Japan", city: "Kyoto", country: "Japan", checkInDate: "2027-03-11", checkInTime: "15:00", checkOutDate: "2027-03-14", checkOutTime: "11:00" } },
    { input: { type: "plan", title: "Nishiki Market lunch", city: "Kyoto", country: "Japan", startLocal: "2027-03-11T12:00", endLocal: "2027-03-11T13:30" } },
    { input: { type: "plan", title: "Kiyomizu-dera", city: "Kyoto", country: "Japan", startLocal: "2027-03-11T14:00", endLocal: "2027-03-11T15:30" } },
    { input: { type: "plan", title: "Tea ceremony at Camellia", city: "Kyoto", country: "Japan", startLocal: "2027-03-11T16:00", endLocal: "2027-03-11T17:00" } },
    { input: { type: "plan", title: "Kaiseki at Gion Karyo", city: "Kyoto", country: "Japan", startLocal: "2027-03-11T19:00", endLocal: "2027-03-11T21:00" } },

    { input: { type: "plan", title: "Fushimi Inari at dawn", city: "Kyoto", country: "Japan", startLocal: "2027-03-12T06:30", endLocal: "2027-03-12T08:30" } },
    { input: { type: "plan", title: "Arashiyama bamboo grove", city: "Kyoto", country: "Japan", startLocal: "2027-03-12T10:00", endLocal: "2027-03-12T11:00" } },
    { input: { type: "plan", title: "Tenryu-ji", city: "Kyoto", country: "Japan", startLocal: "2027-03-12T11:15", endLocal: "2027-03-12T12:15" } },
    { input: { type: "plan", title: "Yudofu lunch", city: "Kyoto", country: "Japan", startLocal: "2027-03-12T12:30", endLocal: "2027-03-12T13:30" } },
    { input: { type: "plan", title: "Kinkaku-ji", city: "Kyoto", country: "Japan", startLocal: "2027-03-12T15:00", endLocal: "2027-03-12T16:00" } },
    { input: { type: "plan", title: "Pontocho dinner", city: "Kyoto", country: "Japan", startLocal: "2027-03-12T19:00", endLocal: "2027-03-12T21:00" } },

    { input: { type: "plan", title: "Day trip to Nara", city: "Nara", country: "Japan", startLocal: "2027-03-13T09:00", endLocal: "2027-03-13T15:00" } },
    { input: { type: "plan", title: "Philosopher's Path", city: "Kyoto", country: "Japan", startLocal: "2027-03-13T16:00", endLocal: "2027-03-13T17:00" } },
    { input: { type: "plan", title: "Farewell dinner", city: "Kyoto", country: "Japan", startLocal: "2027-03-13T19:30", endLocal: "2027-03-13T22:00" } },
    { input: { type: "stay", name: "Stay at Booking.com reservation 4471", city: "Kyoto", country: "Japan", checkInDate: "2027-03-12", checkOutDate: "2027-03-14" }, status: "needs_review" },

    { input: { type: "transfer", title: "Nozomi 208 to Tokyo", mode: "train", fromCity: "Kyoto", toCity: "Tokyo", country: "Japan", startLocal: "2027-03-14T05:50", endLocal: "2027-03-14T08:05" } },
    { input: { type: "flight", flightNumber: "JL6", airline: "Japan Airlines", fromAirport: "HND", toAirport: "JFK", departLocal: "2027-03-14T11:10", arriveLocal: "2027-03-14T10:55", travelers: everyone } },
  ],
};

export const DEMO_TRIPS = [EMPTY_TRIP, SPARSE_TRIP, PACKED_TRIP];

export function demoTripId(spec: DemoTripSpec): string {
  return fixtureUuid(3, 100 + spec.index);
}

export function buildDemoTrip(spec: DemoTripSpec): TripAggregate {
  const tripId = demoTripId(spec);
  const owner = spec.members.find((m) => m.role === "owner") ?? spec.members[0];
  const travelers = spec.travelers.map((name, i) => {
    const user = Object.values(USERS).find((u) => u.name === name);
    return { id: fixtureUuid(7, spec.index * 100 + i + 1), tripId, name, userId: user?.id ?? null };
  });
  const now = "2026-11-20T12:00:00.000Z";
  const items: Item[] = spec.items.map((demo, i) => {
    const p = inputToProposal(demo.input, travelers, { homeZone: USERS[owner.user].homeZone });
    const id = fixtureUuid(6, spec.index * 1000 + i + 1);
    const by = USERS[demo.by ?? owner.user].id;
    return {
      id,
      tripId,
      type: p.type,
      title: p.title,
      start: p.start,
      end: p.end,
      startIsEstimated: p.startIsEstimated,
      endIsEstimated: p.endIsEstimated,
      location: p.location,
      flight: p.flight,
      stay: p.stay,
      transfer: p.transfer,
      travelerIds: p.travelerIds,
      visibility: demo.visibility ?? "everyone",
      visibleToUserIds: [],
      showAsBusy: demo.showAsBusy ?? false,
      booked: demo.booked ?? true,
      status: demo.status ?? p.status,
      notes: p.notes,
      flags: p.problems,
      private: p.private,
      deadlines: p.deadlines.map((d, j) => ({ id: fixtureUuid(9, spec.index * 1000 + i * 10 + j), itemId: id, kind: d.kind, at: d.at, consequence: d.consequence, source: d.source, confirmedBy: null })),
      createdBy: by,
      updatedBy: by,
      createdAt: now,
      updatedAt: now,
    };
  });
  return {
    trip: { id: tripId, name: spec.name, ownerId: USERS[owner.user].id, viewersSeeDeadlines: false, createdAt: now, updatedAt: now },
    memberships: spec.members.map((m) => ({ tripId, userId: USERS[m.user].id, role: m.role })),
    travelers,
    items,
    shareLink: null,
  };
}
