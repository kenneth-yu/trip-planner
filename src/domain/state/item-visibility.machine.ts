import { defineMachine } from "./machine";

export type ItemVisibilityState = "Visible" | "Busy" | "Absent";
export type ItemVisibilityEvent = "hideShowingBusy" | "hide" | "share";

export const machine = defineMachine<ItemVisibilityState, ItemVisibilityEvent>({
  name: "item-visibility",
  title: "Item as seen by one member",
  initial: "Visible",
  finals: [],
  transitions: [
    { from: "Visible", event: "hideShowingBusy", to: "Busy", guard: "creator hides it, shows as busy" },
    { from: "Visible", event: "hide", to: "Absent", guard: "creator hides it" },
    { from: "Busy", event: "share", to: "Visible", guard: "creator shares it" },
    { from: "Absent", event: "share", to: "Visible", guard: "creator shares it" },
  ],
});
