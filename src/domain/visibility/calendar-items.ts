import type { TripView, VisibleItem } from "./project";

export function calendarItems(view: Pick<TripView, "items">): VisibleItem[] {
  return view.items.filter((item) => item.booked);
}
