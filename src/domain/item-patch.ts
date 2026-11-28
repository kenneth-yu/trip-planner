import { z } from "zod";
import { isValidZone } from "./time/format";

const zoned = z.object({
  at: z.string().refine((value) => !Number.isNaN(Date.parse(value)), "Not a time"),
  zone: z.string().max(64).refine(isValidZone, "Not a time zone"),
});

const location = z.object({
  name: z.string().max(200).optional(),
  address: z.string().max(300).optional(),
  city: z.string().max(120).optional(),
  lat: z.number().min(-90).max(90).optional(),
  lng: z.number().min(-180).max(180).optional(),
});

const money = z.object({ amount: z.string().max(14).regex(/^\d+(\.\d{1,2})?$/), currency: z.string().length(3) });

export const privateRowSchema = z.object({
  travelerId: z.string().max(64).nullable(),
  confirmationCode: z.string().max(60).optional(),
  bookingReference: z.string().max(60).optional(),
  seat: z.string().max(20).optional(),
  phone: z.string().max(40).optional(),
  price: money.optional(),
  notes: z.string().max(4000).optional(),
  bookingSite: z.string().max(200).optional(),
});

export const itemPatchSchema = z
  .object({
    title: z.string().min(1).max(200),
    start: zoned,
    end: zoned,
    startIsEstimated: z.boolean(),
    endIsEstimated: z.boolean(),
    notes: z.string().max(4000),
    location: location.nullable(),
    travelerIds: z.array(z.string().max(64)).max(20),
    visibility: z.enum(["everyone", "only_me", "specific"]),
    visibleToUserIds: z.array(z.string().max(64)).max(50),
    showAsBusy: z.boolean(),
    booked: z.boolean(),
    status: z.enum(["confirmed", "needs_review"]),
    flight: z.object({
      airline: z.string().max(80).optional(),
      flightNumber: z.string().min(1).max(10),
      fromAirport: z.string().length(3),
      toAirport: z.string().length(3),
    }),
    stay: z.object({ propertyName: z.string().min(1).max(200), kind: z.enum(["hotel", "rental", "other"]), lateArrivalCutoff: z.string().max(5).optional(), timeToAirportMinutes: z.number().int().min(1).max(1439).optional() }),
    transfer: z.object({
      mode: z.enum(["train", "ferry", "car", "bus", "border", "other"]).optional(),
      fromPlace: location.optional(),
      toPlace: location.optional(),
    }),
    flags: z.array(z.string().max(300)).max(10),
    private: z.array(privateRowSchema).max(20),
  })
  .partial();

export type ItemPatch = z.output<typeof itemPatchSchema>;
