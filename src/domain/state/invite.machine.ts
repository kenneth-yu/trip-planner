import { defineMachine } from "./machine";

export type InviteState = "Pending" | "Accepted" | "Revoked" | "Expired";
export type InviteEvent = "accept" | "revoke" | "expire";

export const machine = defineMachine<InviteState, InviteEvent>({
  name: "invite",
  title: "Invite",
  initial: "Pending",
  finals: ["Accepted", "Revoked", "Expired"],
  transitions: [
    { from: "Pending", event: "accept", to: "Accepted", guard: "signed in, not expired" },
    { from: "Pending", event: "revoke", to: "Revoked", guard: "owner" },
    { from: "Pending", event: "expire", to: "Expired", guard: "past its expiry" },
  ],
});
