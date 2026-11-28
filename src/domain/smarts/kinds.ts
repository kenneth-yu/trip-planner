export const TIP_KINDS = ["airport", "bags", "sleep", "arrival", "border"] as const;

export type TipKind = (typeof TIP_KINDS)[number];

export const LISTED_TIP_KINDS = ["airport", "bags"] as const;

export const TIP_KIND_LABELS: Record<TipKind, string> = {
  airport: "When to leave for the airport",
  bags: "Storing bags between check-in and check-out",
  sleep: "Sleep and time zone changes",
  arrival: "Plans right after a long flight",
  border: "Border crossings",
};

export const TIP_KIND_NAMES: Record<TipKind, string> = {
  airport: "Airport",
  bags: "Bag storage",
  sleep: "Sleep",
  arrival: "Arrival day",
  border: "Border crossing",
};

export function kindsOffAfterSave(currentOff: readonly TipKind[], shown: readonly string[]): TipKind[] {
  const listed: readonly TipKind[] = LISTED_TIP_KINDS;
  return TIP_KINDS.filter((kind) => (listed.includes(kind) ? !shown.includes(kind) : currentOff.includes(kind)));
}
