import { defineMachine } from "./machine";

export type InboxEntryState = "Pending" | "Approved" | "Merged" | "Discarded";
export type InboxEntryEvent = "add" | "merge" | "discard" | "decideWithoutChoice";

export const machine = defineMachine<InboxEntryState, InboxEntryEvent>({
  name: "inbox-entry",
  title: "Inbox entry",
  initial: "Pending",
  finals: ["Approved", "Merged", "Discarded"],
  transitions: [
    { from: "Pending", event: "decideWithoutChoice", to: "Pending", guard: "a difference has no choice, nothing is written" },
    { from: "Pending", event: "add", to: "Approved", guard: "every import difference chosen" },
    { from: "Pending", event: "merge", to: "Merged", guard: "every field difference has keep" },
    { from: "Pending", event: "discard", to: "Discarded" },
  ],
});
