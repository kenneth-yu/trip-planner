import { flightCities } from "@/domain/time/flight-card";
import type { VisibleItem } from "@/domain/visibility/project";

export function itemHeading(item: VisibleItem): string {
  if (item.type !== "flight" || !item.flight) return item.title;
  const to = flightCities(item).to;
  return to ? `${item.flight.flightNumber} to ${to}` : item.flight.flightNumber;
}
