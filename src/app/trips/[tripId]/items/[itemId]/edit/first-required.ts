export function firstEmptyRequired(item: { type: string; flight?: { flightNumber: string }; endIsEstimated: boolean }): string | null {
  if (item.type !== "flight") return null;
  if (!item.flight?.flightNumber) return "flightNumber";
  return item.endIsEstimated ? "arrives" : null;
}
