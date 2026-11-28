import type { Zone } from "../types";

export function placeLabel(zone: Zone): string {
  return (zone.split("/").pop() ?? zone).replace(/_/g, " ");
}

export function durationText(minutes: number): string {
  const whole = Math.max(0, Math.round(minutes));
  const hours = Math.floor(whole / 60);
  const rest = whole % 60;
  if (hours === 0) return `${rest} min`;
  return rest === 0 ? `${hours} h` : `${hours} h ${rest} min`;
}
