import { describe, expect, it } from "vitest";
import { loadMachines } from "../../../scripts/machines";
import { canTransition, defineMachine, InvalidTransition, reachableFrom, statesOf, transition } from "./machine";

const door = defineMachine<"Open" | "Closed" | "Gone", "close" | "open" | "remove">({
  name: "door",
  title: "Door",
  initial: "Open",
  finals: ["Gone"],
  transitions: [
    { from: "Open", event: "close", to: "Closed" },
    { from: "Closed", event: "open", to: "Open" },
    { from: "Closed", event: "remove", to: "Gone" },
  ],
});

describe("transition tables", () => {
  it("follows a valid transition", () => {
    expect(transition(door, "Open", "close")).toBe("Closed");
    expect(canTransition(door, "Closed", "remove")).toBe(true);
  });

  it("rejects an event that has no transition from the state", () => {
    expect(canTransition(door, "Open", "remove")).toBe(false);
    expect(() => transition(door, "Open", "remove")).toThrow(InvalidTransition);
  });

  it("final states have no exits, and defining one with an exit fails", () => {
    for (const event of ["close", "open", "remove"] as const) expect(canTransition(door, "Gone", event)).toBe(false);
    expect(() =>
      defineMachine<"A" | "B", "go">({ name: "bad", title: "Bad", initial: "A", finals: ["B"], transitions: [{ from: "A", event: "go", to: "B" }, { from: "B", event: "go", to: "A" }] }),
    ).toThrow("final state B has an exit");
  });

  it("two transitions on the same event from one state are rejected", () => {
    expect(() =>
      defineMachine<"A" | "B" | "C", "go">({ name: "bad", title: "Bad", initial: "A", finals: [], transitions: [{ from: "A", event: "go", to: "B" }, { from: "A", event: "go", to: "C" }] }),
    ).toThrow("two transitions");
  });

  it("InvalidTransition says which machine, state and event", () => {
    expect(() => transition(door, "Gone", "open")).toThrow("door: no transition from Gone on open.");
  });
});

describe("every machine in src/domain/state", async () => {
  const machines = await loadMachines();

  it("finds the documented machines", () => {
    expect(machines.map((m) => m.name).sort()).toEqual(["assistant-token", "calendar-mirror", "inbox-entry", "invite", "item-visibility", "view-link"]);
  });

  it.each(machines.map((m) => [m.name, m] as const))("%s: every state is reachable from the initial state", (_name, m) => {
    const reached = reachableFrom(m, m.initial);
    expect([...statesOf(m)].filter((s) => !reached.has(s))).toEqual([]);
  });

  it.each(machines.map((m) => [m.name, m] as const))("%s: final states have no exits", (_name, m) => {
    for (const final of m.finals) expect(m.transitions.filter((t) => t.from === final)).toEqual([]);
  });
});
