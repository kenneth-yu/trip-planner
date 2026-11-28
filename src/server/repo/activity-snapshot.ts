import { z } from "zod";
import type { Item } from "@/domain/types";

const zoned = z.object({ at: z.string(), zone: z.string() });
const place = z.object({ name: z.string().optional(), address: z.string().optional(), city: z.string().optional(), lat: z.number().optional(), lng: z.number().optional() });

export const itemSnapshotSchema: z.ZodType<Item> = z.object({
  id: z.string(),
  tripId: z.string(),
  type: z.enum(["flight", "stay", "plan", "transfer"]),
  title: z.string(),
  start: zoned,
  end: zoned,
  startIsEstimated: z.boolean(),
  endIsEstimated: z.boolean(),
  location: place.nullable(),
  flight: z.object({ airline: z.string().optional(), flightNumber: z.string(), fromAirport: z.string(), toAirport: z.string() }).optional(),
  stay: z.object({ propertyName: z.string(), kind: z.enum(["hotel", "rental", "other"]), lateArrivalCutoff: z.string().optional() }).optional(),
  transfer: z.object({ mode: z.enum(["train", "ferry", "car", "bus", "border", "other"]).optional(), fromPlace: place.optional(), toPlace: place.optional() }).optional(),
  travelerIds: z.array(z.string()),
  visibility: z.enum(["everyone", "only_me", "specific"]),
  visibleToUserIds: z.array(z.string()),
  showAsBusy: z.boolean(),
  booked: z.boolean().default(true),
  status: z.enum(["confirmed", "needs_review"]),
  notes: z.string(),
  flags: z.array(z.string()),
  private: z.array(
    z.object({
      travelerId: z.string().nullable(),
      confirmationCode: z.string().optional(),
      bookingReference: z.string().optional(),
      seat: z.string().optional(),
      phone: z.string().optional(),
      price: z.object({ amount: z.string(), currency: z.string() }).optional(),
      notes: z.string().optional(),
      bookingSite: z.string().optional(),
    }),
  ),
  deadlines: z.array(
    z.object({
      id: z.string(),
      itemId: z.string(),
      kind: z.enum(["free_cancellation", "partial_refund", "change", "other"]),
      at: zoned,
      consequence: z.string(),
      source: z.enum(["manual", "parsed"]),
      confirmedBy: z.string().nullable(),
    }),
  ),
  createdBy: z.string(),
  updatedBy: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export function readSnapshot(value: unknown): Item | null {
  if (value === null || value === undefined) return null;
  return itemSnapshotSchema.parse(value);
}
