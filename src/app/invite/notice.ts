import { z } from "zod";
import type { Role } from "@/domain/types";
import { roleInWords } from "./role-words";

const Notice = z.object({
  kind: z.enum(["joined", "already", "already-ask"]),
  role: z.enum(["owner", "editor", "viewer"]),
  tripId: z.string().uuid(),
});

export interface NoticeInput {
  tripId: string;
  role: Role;
  alreadyMember: boolean;
  invitedRole: "editor" | "viewer";
}

export function noticeValue(input: NoticeInput): string {
  const asksForMore = input.alreadyMember && input.role === "viewer" && input.invitedRole === "editor";
  const kind = !input.alreadyMember ? "joined" : asksForMore ? "already-ask" : "already";
  return `${kind}.${input.role}.${input.tripId}`;
}

export function noticeMessage(value: string | undefined, tripId: string): string | null {
  if (!value) return null;
  const [kind, role, id] = value.split(".");
  const parsed = Notice.safeParse({ kind, role, tripId: id });
  if (!parsed.success || parsed.data.tripId !== tripId) return null;
  const words = roleInWords(parsed.data.role);
  if (parsed.data.kind === "joined") return `You joined as ${words}.`;
  const base = `You are already on this trip as ${words}.`;
  return parsed.data.kind === "already-ask" ? `${base} Ask the trip owner to change your role.` : base;
}
