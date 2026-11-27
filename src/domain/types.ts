export type Zone = string;

export interface ZonedTime {
  at: string;
  zone: Zone;
}

export type ItemType = "flight" | "stay" | "plan" | "transfer";
export type Visibility = "everyone" | "only_me" | "specific";
export type Role = "owner" | "editor" | "viewer";
export type ItemStatus = "confirmed" | "needs_review";

export interface Location {
  name?: string;
  address?: string;
  city?: string;
  lat?: number;
  lng?: number;
}

export interface FlightDetails {
  airline?: string;
  flightNumber: string;
  fromAirport: string;
  toAirport: string;
}

export interface StayDetails {
  propertyName: string;
  kind: "hotel" | "rental" | "other";
  lateArrivalCutoff?: string;
}

export interface TransferDetails {
  mode?: "train" | "ferry" | "car" | "bus" | "border" | "other";
  fromPlace?: Location;
  toPlace?: Location;
}

export interface Money {
  amount: string;
  currency: string;
}

export interface ItemPrivate {
  travelerId: string | null;
  confirmationCode?: string;
  bookingReference?: string;
  seat?: string;
  phone?: string;
  price?: Money;
  notes?: string;
  bookingSite?: string;
}

export const SENSITIVE_FIELDS = [
  "confirmationCode",
  "bookingReference",
  "seat",
  "phone",
  "price",
  "bookingSite",
  "notes",
] as const satisfies readonly (keyof ItemPrivate)[];

export type DeadlineKind = "free_cancellation" | "partial_refund" | "change" | "other";

export interface Deadline {
  id: string;
  itemId: string;
  kind: DeadlineKind;
  at: ZonedTime;
  consequence: string;
  source: "manual" | "parsed";
  confirmedBy: string | null;
}

export interface Item {
  id: string;
  tripId: string;
  type: ItemType;
  title: string;
  start: ZonedTime;
  end: ZonedTime;
  startIsEstimated: boolean;
  endIsEstimated: boolean;
  location: Location | null;
  flight?: FlightDetails;
  stay?: StayDetails;
  transfer?: TransferDetails;
  travelerIds: string[];
  visibility: Visibility;
  visibleToUserIds: string[];
  showAsBusy: boolean;
  status: ItemStatus;
  notes: string;
  flags: string[];
  private: ItemPrivate[];
  deadlines: Deadline[];
  createdBy: string;
  updatedBy: string;
  createdAt: string;
  updatedAt: string;
}

export interface Trip {
  id: string;
  name: string;
  ownerId: string;
  viewersSeeDeadlines: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface Traveler {
  id: string;
  tripId: string;
  name: string;
  userId: string | null;
}

export interface Membership {
  tripId: string;
  userId: string;
  role: Role;
}

export interface ShareLinkSettings {
  enabled: boolean;
  showsDeadlines: boolean;
}

export interface TripAggregate {
  trip: Trip;
  memberships: Membership[];
  travelers: Traveler[];
  items: Item[];
  shareLink: ShareLinkSettings | null;
}

export type Requester =
  | { kind: "member"; userId: string; homeZone: Zone }
  | { kind: "link"; homeZone: Zone };
