import { z } from "zod";
import type { ItemPrivate } from "@/domain/types";
import type { ProposedItem } from "@/domain/import/proposal";

const zoned = z.object({ at: z.string(), zone: z.string() });

const location = z.object({
  name: z.string().optional(),
  address: z.string().optional(),
  city: z.string().optional(),
  lat: z.number().optional(),
  lng: z.number().optional(),
});

const itemPrivateData = z.object({
  confirmationCode: z.string().optional(),
  bookingReference: z.string().optional(),
  seat: z.string().optional(),
  phone: z.string().optional(),
  price: z.object({ amount: z.string(), currency: z.string() }).optional(),
  bookingSite: z.string().optional(),
  notes: z.string().optional(),
});

export type ItemPrivateData = Omit<ItemPrivate, "travelerId">;
export const itemPrivateSchema: z.ZodType<ItemPrivateData> = itemPrivateData;

const itemTypes = z.enum(["flight", "stay", "plan", "transfer"]);

export const proposedItemSchema: z.ZodType<ProposedItem> = z.object({
  type: itemTypes,
  title: z.string(),
  start: zoned,
  end: zoned,
  startIsEstimated: z.boolean(),
  endIsEstimated: z.boolean(),
  location: location.nullable(),
  flight: z.object({ airline: z.string().optional(), flightNumber: z.string(), fromAirport: z.string(), toAirport: z.string() }).optional(),
  stay: z.object({ propertyName: z.string(), kind: z.enum(["hotel", "rental", "other"]), lateArrivalCutoff: z.string().optional(), timeToAirportMinutes: z.number().optional() }).optional(),
  transfer: z
    .object({
      mode: z.enum(["train", "ferry", "car", "bus", "border", "other"]).optional(),
      fromPlace: location.optional(),
      toPlace: location.optional(),
    })
    .optional(),
  travelerIds: z.array(z.string()),
  private: z.array(itemPrivateData.extend({ travelerId: z.string().nullable() })),
  deadlines: z.array(
    z.object({
      kind: z.enum(["free_cancellation", "partial_refund", "change", "other"]),
      at: zoned,
      consequence: z.string(),
      source: z.enum(["parsed", "manual"]),
    }),
  ),
  notes: z.string(),
  status: z.enum(["confirmed", "needs_review"]),
  problems: z.array(z.string()),
});

export const importPayloadSchema = z.object({ raw: z.array(z.unknown()), proposed: proposedItemSchema, unparsed: z.array(z.string()).default([]) });
export type ImportPayload = z.infer<typeof importPayloadSchema>;

export const activityPayloadSchema = z.object({ before: z.unknown(), after: z.unknown() });
export type ActivityPayload = { before: unknown; after: unknown };
