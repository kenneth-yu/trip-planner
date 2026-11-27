import type { TripView, VisibleItem } from "@/domain/visibility/project";

export function itemOf(view: TripView, itemId: string): VisibleItem | null {
  return view.items.find((i) => i.id === itemId) ?? null;
}
