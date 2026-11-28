export interface CalendarLinkState {
  url: string | null;
  turnedOff: boolean;
  error: string | null;
}

export const noCalendarLink: CalendarLinkState = { url: null, turnedOff: false, error: null };

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

function plural(count: number, unit: string): string {
  return `${count} ${unit}${count === 1 ? "" : "s"} ago`;
}

export function agoText(elapsedMs: number): string {
  if (elapsedMs < MINUTE) return "just now";
  if (elapsedMs < HOUR) return plural(Math.floor(elapsedMs / MINUTE), "minute");
  if (elapsedMs < DAY) return plural(Math.floor(elapsedMs / HOUR), "hour");
  return plural(Math.floor(elapsedMs / DAY), "day");
}

export function lastReadText(lastReadAt: Date | null, now: Date): string {
  return lastReadAt ? `Last read by a calendar app ${agoText(Math.max(0, now.getTime() - lastReadAt.getTime()))}.` : "Not read by a calendar app yet.";
}

export function subscribeUrl(url: string): string {
  return url.replace(/^https?:/, "webcal:");
}
