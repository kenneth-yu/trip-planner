import { defineMachine } from "./machine";

export type AssistantTokenState = "Active" | "Revoked";
export type AssistantTokenEvent = "use" | "revoke";

export const machine = defineMachine<AssistantTokenState, AssistantTokenEvent>({
  name: "assistant-token",
  title: "Assistant connection",
  initial: "Active",
  finals: ["Revoked"],
  transitions: [
    { from: "Active", event: "use", to: "Active", guard: "tool call, last used updated" },
    { from: "Active", event: "revoke", to: "Revoked", guard: "Disconnect" },
  ],
});
