import { defineMachine } from "./machine";

export type CalendarMirrorState = "Off" | "Connecting" | "InSync" | "Syncing" | "Failed" | "TornDown";
export type CalendarMirrorEvent = "enable" | "consentDenied" | "sync" | "synced" | "failed" | "disable" | "memberLeft";

export const machine = defineMachine<CalendarMirrorState, CalendarMirrorEvent>({
  name: "calendar-mirror",
  title: "Google Calendar mirror (per member, per trip)",
  initial: "Off",
  finals: ["TornDown"],
  transitions: [
    { from: "Off", event: "enable", to: "Connecting" },
    { from: "Connecting", event: "consentDenied", to: "Off", guard: "consent denied or scope missing" },
    { from: "Connecting", event: "sync", to: "Syncing", guard: "tokens stored, first sync" },
    { from: "InSync", event: "sync", to: "Syncing", guard: "trip changed or Sync now" },
    { from: "Failed", event: "sync", to: "Syncing", guard: "next change or Sync now, resumes from the event map" },
    { from: "Syncing", event: "synced", to: "InSync", guard: "all ops applied, last error cleared" },
    { from: "Syncing", event: "failed", to: "Failed", guard: "Google error, applied ops kept" },
    { from: "Syncing", event: "memberLeft", to: "TornDown", guard: "desired set is empty, all events deleted" },
    { from: "Connecting", event: "disable", to: "Off" },
    { from: "InSync", event: "disable", to: "Off", guard: "Stop mirroring" },
    { from: "Failed", event: "disable", to: "Off", guard: "Stop mirroring" },
  ],
});
