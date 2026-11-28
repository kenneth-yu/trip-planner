import { TIP_KIND_NAMES, type TipKind } from "@/domain/smarts/kinds";

export const FLASH_COOKIE = "trip-flash";

export const FLASH_KINDS = ["saved", "deleted", "fixed", "fine", "tip_hidden_airport", "tip_hidden_bags", "tip_hidden_sleep", "tip_hidden_arrival", "tip_hidden_border"] as const;

export type FlashKind = (typeof FLASH_KINDS)[number];

export function flashPath(tripId: string): string {
  return `/trips/${tripId}`;
}

export const TIP_HIDDEN_FLASH: Record<TipKind, FlashKind> = {
  airport: "tip_hidden_airport",
  bags: "tip_hidden_bags",
  sleep: "tip_hidden_sleep",
  arrival: "tip_hidden_arrival",
  border: "tip_hidden_border",
};

const tipsOff = (kind: TipKind) => `${TIP_KIND_NAMES[kind]} tips are off. Turn them back on in Account.`;

export const FLASH_TEXT: Record<FlashKind, string> = {
  saved: "Saved",
  deleted: "Item deleted.",
  fixed: "Time changed.",
  fine: "Marked as fine.",
  tip_hidden_airport: tipsOff("airport"),
  tip_hidden_bags: tipsOff("bags"),
  tip_hidden_sleep: tipsOff("sleep"),
  tip_hidden_arrival: tipsOff("arrival"),
  tip_hidden_border: tipsOff("border"),
};
