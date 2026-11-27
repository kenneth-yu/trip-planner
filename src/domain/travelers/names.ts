import { z } from "zod";

export const NAME_MAX = 80;

export const TripNameInput = z.string().trim().min(1, "Give the trip a name.").max(NAME_MAX, "Keep the name under 80 characters.");

export const TravelerNameInput = z.string().trim().min(1, "Add a name.").max(NAME_MAX, "Keep the name under 80 characters.");

export function nameKey(name: string): string {
  return name.trim().replace(/\s+/g, " ").toLowerCase();
}

export function sameName(a: string, b: string): boolean {
  return nameKey(a) === nameKey(b);
}

export function duplicateMessage(name: string): string {
  return `There is already a traveler called ${name.trim().replace(/\s+/g, " ")}.`;
}

export type TravelerRelation = { kind: "you" } | { kind: "account"; accountName: string } | { kind: "matched" } | { kind: "none" };

export function relationOf(traveler: { name: string; userId: string | null }, members: { userId: string; name: string }[], viewerUserId: string): TravelerRelation {
  if (traveler.userId === null) return { kind: "none" };
  if (traveler.userId === viewerUserId) return { kind: "you" };
  const member = members.find((m) => m.userId === traveler.userId);
  if (!member) return { kind: "none" };
  return sameName(member.name, traveler.name) ? { kind: "matched" } : { kind: "account", accountName: member.name };
}

export function relationText(relation: TravelerRelation): string | null {
  if (relation.kind === "you") return "You";
  if (relation.kind === "account") return `${relation.accountName}'s account`;
  if (relation.kind === "none") return "No account yet";
  return null;
}
