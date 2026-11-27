import type { Role } from "@/domain/types";

export function roleInWords(role: Role): string {
  if (role === "owner") return "the owner";
  return role === "editor" ? "an editor" : "a viewer";
}

export function roleName(role: Role): string {
  return role === "owner" ? "Owner" : role === "editor" ? "Editor" : "Viewer";
}
