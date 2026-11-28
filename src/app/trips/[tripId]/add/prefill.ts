import { z } from "zod";
import type { ItemFormValues } from "@/domain/import/item-form";

const FIRST_YEAR = 2000;
const LAST_YEAR = 2100;

function isRealDate(text: string): boolean {
  const [year, month, day] = text.split("-").map(Number);
  const d = new Date(Date.UTC(year, month - 1, day));
  return year >= FIRST_YEAR && year <= LAST_YEAR && d.getUTCFullYear() === year && d.getUTCMonth() === month - 1 && d.getUTCDate() === day;
}

const date = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine(isRealDate);

const Prefill = z.object({
  type: z.enum(["flight", "stay", "plan", "transfer"]),
  city: z.string().trim().min(1).max(120).optional().catch(undefined),
  checkIn: date.optional().catch(undefined),
  checkOut: date.optional().catch(undefined),
});

export function prefillFromQuery(query: Record<string, string | string[] | undefined>): ItemFormValues | undefined {
  const first = (key: string) => {
    const v = query[key];
    return typeof v === "string" ? v : undefined;
  };
  const parsed = Prefill.safeParse({ type: first("type"), city: first("city"), checkIn: first("checkIn"), checkOut: first("checkOut") });
  if (!parsed.success) return undefined;
  const { type, city, checkIn, checkOut } = parsed.data;
  const fields: Record<string, string> = {};
  if (type === "stay") {
    if (city) fields.place = city;
    if (checkIn) fields.checkInDate = checkIn;
    if (checkOut) fields.checkOutDate = checkOut;
  }
  return { type, fields, seats: [], visibility: "everyone", visibleToUserIds: [], showAsBusy: false };
}
