import { z } from "zod";
import type { ItemPrivate, Traveler, Zone } from "../types";
import { fromLocal } from "../time/format";
import { airportZone, cityZone, findCityInText } from "../time/places";
import { DEFAULT_CHECK_IN, DEFAULT_CHECK_OUT } from "./calendar-event";
import type { ProposedItem } from "./proposal";

const localDateTime = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/, "Use local time like 2026-12-05T08:50");
const localDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use a date like 2026-12-02");
const clock = z.string().regex(/^\d{2}:\d{2}$/, "Use a 24 hour time like 15:00");

const money = z.object({ amount: z.string().regex(/^\d+(\.\d{1,2})?$/), currency: z.string().length(3) });

const travelerPrivate = z.object({
  traveler: z.string().describe("Traveler name as it appears on the trip"),
  seat: z.string().optional(),
  confirmationCode: z.string().optional(),
});

const common = {
  travelers: z.array(z.string()).optional().describe("Traveler names. Defaults to everyone on the trip."),
  notes: z.string().max(4000).optional(),
  confirmationCode: z.string().optional(),
  bookingReference: z.string().optional(),
  phone: z.string().optional(),
  price: money.optional(),
  bookingSite: z.string().optional(),
  deadlines: z
    .array(
      z.object({
        kind: z.enum(["free_cancellation", "partial_refund", "change", "other"]),
        local: localDateTime.describe("Local time at the booking's place"),
        consequence: z.string().max(200).optional(),
      }),
    )
    .optional(),
  source: z.string().max(500).optional().describe("Where this came from, e.g. the email subject"),
};

export const FlightInput = z.object({
  type: z.literal("flight"),
  flightNumber: z.string().regex(/^[A-Z0-9]{2}\s?\d{1,4}$/i, "Use a flight number like CX509"),
  airline: z.string().optional(),
  fromAirport: z.string().length(3).describe("IATA code, e.g. NRT"),
  toAirport: z.string().length(3).describe("IATA code, e.g. HKG"),
  departLocal: localDateTime.describe("Departure, local time at the departure airport"),
  arriveLocal: localDateTime.describe("Arrival, local time at the arrival airport"),
  seats: z.array(travelerPrivate).optional(),
  ...common,
});

export const StayInput = z.object({
  type: z.literal("stay"),
  name: z.string().min(1),
  kind: z.enum(["hotel", "rental", "other"]).optional(),
  address: z.string().optional(),
  city: z.string().optional().describe("City, used for the time zone when the address does not name one"),
  checkInDate: localDate,
  checkInTime: clock.optional().describe("Omit when unknown; 15:00 is used and marked estimated"),
  checkOutDate: localDate,
  checkOutTime: clock.optional().describe("Omit when unknown; 11:00 is used and marked estimated"),
  lateArrivalCutoff: clock.optional(),
  ...common,
});

export const PlanInput = z.object({
  type: z.literal("plan"),
  title: z.string().min(1),
  place: z.string().optional(),
  address: z.string().optional(),
  city: z.string().optional(),
  startLocal: localDateTime,
  endLocal: localDateTime,
  ...common,
});

export const TransferInput = z.object({
  type: z.literal("transfer"),
  title: z.string().optional(),
  mode: z.enum(["train", "ferry", "car", "bus", "border", "other"]).optional(),
  fromCity: z.string(),
  toCity: z.string(),
  startLocal: localDateTime,
  endLocal: localDateTime,
  ...common,
});

export const ItemInput = z.discriminatedUnion("type", [FlightInput, StayInput, PlanInput, TransferInput]);
export type ItemInput = z.infer<typeof ItemInput>;

export class InputProblem extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InputProblem";
  }
}

function zoneForPlace(city: string | undefined, address: string | undefined, what: string): { zone: Zone; city: string } {
  if (city) {
    const zone = cityZone(city);
    if (zone) return { zone, city };
  }
  const found = findCityInText([address, city].filter(Boolean).join(", "));
  if (found) return found;
  throw new InputProblem(`We could not tell which city ${what} is in. Add the city.`);
}

function resolveTravelers(names: string[] | undefined, travelers: Pick<Traveler, "id" | "name">[]): string[] {
  if (!names?.length) return travelers.map((t) => t.id);
  return names.map((n) => {
    const key = n.trim().toLowerCase();
    const t = travelers.find((x) => x.id === n || x.name.toLowerCase() === key || x.name.toLowerCase().split(" ")[0] === key);
    if (!t) throw new InputProblem(`There is no traveler called "${n}" on this trip.`);
    return t.id;
  });
}

export function inputToProposal(raw: unknown, travelers: Pick<Traveler, "id" | "name">[]): ProposedItem {
  const input = ItemInput.parse(raw);
  const travelerIds = resolveTravelers(input.travelers, travelers);
  const shared: Omit<ItemPrivate, "travelerId"> = {
    confirmationCode: input.confirmationCode,
    bookingReference: input.bookingReference,
    phone: input.phone,
    price: input.price,
    bookingSite: input.bookingSite,
  };
  const privates: ItemPrivate[] = Object.values(shared).some((v) => v !== undefined)
    ? [{ travelerId: travelerIds.length === 1 ? travelerIds[0] : null, ...shared }]
    : [];
  const problems: string[] = [];
  const base = {
    travelerIds,
    notes: [input.notes, input.source && `Source: ${input.source}`].filter(Boolean).join("\n"),
    status: "confirmed" as const,
    problems,
  };

  const deadlinesIn = (zone: Zone) =>
    (input.deadlines ?? []).map((d) => ({
      kind: d.kind,
      at: fromLocal(d.local, zone),
      consequence: d.consequence ?? "Check the booking terms",
      source: "parsed" as const,
    }));

  switch (input.type) {
    case "flight": {
      const from = input.fromAirport.toUpperCase();
      const to = input.toAirport.toUpperCase();
      const fromZone = airportZone(from);
      const toZone = airportZone(to);
      if (!fromZone) throw new InputProblem(`We do not know the airport "${from}". Check the code.`);
      if (!toZone) throw new InputProblem(`We do not know the airport "${to}". Check the code.`);
      const start = fromLocal(input.departLocal, fromZone);
      const end = fromLocal(input.arriveLocal, toZone);
      if (end.at <= start.at) throw new InputProblem("The arrival is before the departure. Check both are local times at each airport.");
      const flightNumber = input.flightNumber.replace(/\s/g, "").toUpperCase();
      const seats: ItemPrivate[] = (input.seats ?? []).map((s) => ({
        travelerId: resolveTravelers([s.traveler], travelers)[0],
        seat: s.seat,
        confirmationCode: s.confirmationCode,
      }));
      return {
        ...base,
        type: "flight",
        title: flightNumber,
        start,
        end,
        startIsEstimated: false,
        endIsEstimated: false,
        location: null,
        flight: { flightNumber, airline: input.airline, fromAirport: from, toAirport: to },
        private: [...seats, ...privates],
        deadlines: deadlinesIn(fromZone),
      };
    }
    case "stay": {
      const place = zoneForPlace(input.city, input.address, input.name);
      const start = fromLocal(`${input.checkInDate}T${input.checkInTime ?? DEFAULT_CHECK_IN}`, place.zone);
      const end = fromLocal(`${input.checkOutDate}T${input.checkOutTime ?? DEFAULT_CHECK_OUT}`, place.zone);
      if (end.at <= start.at) throw new InputProblem("Check out is before check in.");
      return {
        ...base,
        type: "stay",
        title: input.name,
        start,
        end,
        startIsEstimated: !input.checkInTime,
        endIsEstimated: !input.checkOutTime,
        location: { name: input.name, address: input.address, city: place.city },
        stay: { propertyName: input.name, kind: input.kind ?? "hotel", lateArrivalCutoff: input.lateArrivalCutoff },
        private: privates,
        deadlines: deadlinesIn(place.zone),
      };
    }
    case "plan": {
      const place = zoneForPlace(input.city, input.address ?? input.place, input.title);
      const start = fromLocal(input.startLocal, place.zone);
      const end = fromLocal(input.endLocal, place.zone);
      if (end.at < start.at) throw new InputProblem("The plan ends before it starts.");
      return {
        ...base,
        type: "plan",
        title: input.title,
        start,
        end,
        startIsEstimated: false,
        endIsEstimated: false,
        location: { name: input.place, address: input.address, city: place.city },
        private: privates,
        deadlines: deadlinesIn(place.zone),
      };
    }
    case "transfer": {
      const from = zoneForPlace(input.fromCity, undefined, "the start");
      const to = zoneForPlace(input.toCity, undefined, "the end");
      const start = fromLocal(input.startLocal, from.zone);
      const end = fromLocal(input.endLocal, to.zone);
      if (end.at < start.at) throw new InputProblem("The transfer ends before it starts.");
      return {
        ...base,
        type: "transfer",
        title: input.title ?? `${from.city} to ${to.city}`,
        start,
        end,
        startIsEstimated: false,
        endIsEstimated: false,
        location: { city: to.city },
        transfer: { mode: input.mode, fromPlace: { city: from.city }, toPlace: { city: to.city } },
        private: privates,
        deadlines: deadlinesIn(from.zone),
      };
    }
  }
}
