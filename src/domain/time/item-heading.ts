import type { VisibleItem } from "../visibility/project";
import { flightCities } from "./flight-card";

export function itemHeading(item: VisibleItem): string {
  if (item.type !== "flight" || !item.flight) return item.title;
  const to = flightCities(item).to;
  return to ? `${item.flight.flightNumber} to ${to}` : item.flight.flightNumber;
}
