import { defineMachine } from "./machine";

export type SessionState = "SignedOut" | "Active";
export type SessionEvent = "signIn" | "roll" | "expire" | "signOut";

export const machine = defineMachine<SessionState, SessionEvent>({
  name: "session",
  title: "Sign in session",
  initial: "SignedOut",
  finals: [],
  transitions: [
    { from: "SignedOut", event: "signIn", to: "Active", guard: "Google, Apple, email link or dev sign in" },
    { from: "Active", event: "roll", to: "Active", guard: "used more than a day into its window, stored expiry moves to 30 days from now" },
    { from: "Active", event: "expire", to: "SignedOut", guard: "30 days unused, row deleted on lookup" },
    { from: "Active", event: "signOut", to: "SignedOut", guard: "Sign out, row and cookie deleted" },
  ],
});
