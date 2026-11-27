export const FLASH_COOKIE = "trip-flash";

export const FLASH_KINDS = ["saved", "deleted"] as const;

export type FlashKind = (typeof FLASH_KINDS)[number];

export function flashPath(tripId: string): string {
  return `/trips/${tripId}`;
}

export const FLASH_TEXT: Record<FlashKind, string> = { saved: "Saved", deleted: "Item deleted." };
