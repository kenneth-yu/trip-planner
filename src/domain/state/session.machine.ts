export const sessionMachine = {
  id: "session",
  initial: "SignedOut",
  states: {
    SignedOut: { on: { signIn: "Active" } },
    Active: { on: { expire: "Expired", signOut: "SignedOut", roll: "Active" } },
    Expired: { on: { signIn: "Active" } },
  },
} as const;
