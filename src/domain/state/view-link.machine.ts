import { defineMachine } from "./machine";

export type ViewLinkState = "Off" | "On";
export type ViewLinkEvent = "enable" | "rotate" | "disable";

export const machine = defineMachine<ViewLinkState, ViewLinkEvent>({
  name: "view-link",
  title: "View link",
  initial: "Off",
  finals: [],
  transitions: [
    { from: "Off", event: "enable", to: "On", guard: "owner" },
    { from: "On", event: "rotate", to: "On", guard: "old link stops working" },
    { from: "On", event: "disable", to: "Off", guard: "owner" },
  ],
});
