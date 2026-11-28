export type TipKind = "airport" | "bags" | "sleep" | "arrival" | "border";

export const TIP_KINDS: readonly TipKind[] = ["airport", "bags", "sleep", "arrival", "border"];

export const TIP_KIND_LABELS: Record<TipKind, string> = {
  airport: "When to leave for the airport",
  bags: "Storing bags between check-in and check-out",
  sleep: "Sleep and time zone changes",
  arrival: "Getting from the airport",
  border: "Passport and entry reminders",
};
