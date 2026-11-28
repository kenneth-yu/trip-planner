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

export interface FlashLink {
  label: string;
  href: string;
}

export interface FlashMessage {
  lead: string;
  link?: FlashLink;
}

export const ACCOUNT_LINK: FlashLink = { label: "Account", href: "/account#travel-smarts" };

const tipsOff = (kind: TipKind): FlashMessage => ({ lead: `${TIP_KIND_NAMES[kind]} tips are off. Turn them back on in`, link: ACCOUNT_LINK });

export const FLASH_MESSAGE: Record<FlashKind, FlashMessage> = {
  saved: { lead: "Saved" },
  deleted: { lead: "Item deleted." },
  fixed: { lead: "Time changed." },
  fine: { lead: "Marked as fine." },
  tip_hidden_airport: tipsOff("airport"),
  tip_hidden_bags: tipsOff("bags"),
  tip_hidden_sleep: tipsOff("sleep"),
  tip_hidden_arrival: tipsOff("arrival"),
  tip_hidden_border: tipsOff("border"),
};

export function flashText(message: FlashMessage): string {
  return message.link ? `${message.lead} ${message.link.label}.` : message.lead;
}

export const FLASH_TEXT: Record<FlashKind, string> = {
  saved: flashText(FLASH_MESSAGE.saved),
  deleted: flashText(FLASH_MESSAGE.deleted),
  fixed: flashText(FLASH_MESSAGE.fixed),
  fine: flashText(FLASH_MESSAGE.fine),
  tip_hidden_airport: flashText(FLASH_MESSAGE.tip_hidden_airport),
  tip_hidden_bags: flashText(FLASH_MESSAGE.tip_hidden_bags),
  tip_hidden_sleep: flashText(FLASH_MESSAGE.tip_hidden_sleep),
  tip_hidden_arrival: flashText(FLASH_MESSAGE.tip_hidden_arrival),
  tip_hidden_border: flashText(FLASH_MESSAGE.tip_hidden_border),
};
