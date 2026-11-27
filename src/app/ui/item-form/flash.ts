import { z } from "zod";

export const FLASH_COOKIE = "trip-flash";

export const flashKind = z.enum(["saved", "deleted"]);

export type FlashKind = z.infer<typeof flashKind>;

export function flashPath(tripId: string): string {
  return `/trips/${tripId}`;
}

export const FLASH_TEXT: Record<FlashKind, string> = { saved: "Saved", deleted: "Item deleted." };
