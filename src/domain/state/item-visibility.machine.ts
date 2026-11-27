import { defineMachine } from "./machine";

export type ItemVisibilityState = "Everyone" | "OnlyMeBusy" | "OnlyMeHidden" | "SpecificBusy" | "SpecificHidden";
export type ItemVisibilityEvent = "shareWithEveryone" | "onlyMe" | "onlySome" | "showAsBusy" | "stopShowingBusy";

export const machine = defineMachine<ItemVisibilityState, ItemVisibilityEvent>({
  name: "item-visibility",
  title: "Item visibility (set by its creator)",
  initial: "Everyone",
  finals: [],
  transitions: [
    { from: "Everyone", event: "onlyMe", to: "OnlyMeHidden", guard: "visibility only_me, showAsBusy off" },
    { from: "Everyone", event: "onlySome", to: "SpecificHidden", guard: "visibility specific, showAsBusy off" },
    { from: "OnlyMeHidden", event: "shareWithEveryone", to: "Everyone" },
    { from: "OnlyMeHidden", event: "onlySome", to: "SpecificHidden" },
    { from: "OnlyMeHidden", event: "showAsBusy", to: "OnlyMeBusy", guard: "others see a Busy block" },
    { from: "OnlyMeBusy", event: "shareWithEveryone", to: "Everyone" },
    { from: "OnlyMeBusy", event: "onlySome", to: "SpecificBusy" },
    { from: "OnlyMeBusy", event: "stopShowingBusy", to: "OnlyMeHidden", guard: "others see nothing" },
    { from: "SpecificHidden", event: "shareWithEveryone", to: "Everyone" },
    { from: "SpecificHidden", event: "onlyMe", to: "OnlyMeHidden" },
    { from: "SpecificHidden", event: "showAsBusy", to: "SpecificBusy", guard: "people not listed see a Busy block" },
    { from: "SpecificBusy", event: "shareWithEveryone", to: "Everyone" },
    { from: "SpecificBusy", event: "onlyMe", to: "OnlyMeBusy" },
    { from: "SpecificBusy", event: "stopShowingBusy", to: "SpecificHidden", guard: "people not listed see nothing" },
  ],
});
