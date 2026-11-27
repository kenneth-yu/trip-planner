export const sessionMachine = {
  id: "session",
  initial: "SignedOut",
  states: {
    SignedOut: { on: { signIn: "Active" } },
    Active: { on: { roll: "Active", expire: "SignedOut", signOut: "SignedOut" } },
  },
} as const;
