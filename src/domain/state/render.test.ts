import { describe, expect, it } from "vitest";
import { loadMachines } from "../../../scripts/machines";
import { defineMachine } from "./machine";
import { renderDocument, renderMachine } from "./render";

const lamp = defineMachine<"Off" | "On" | "Broken", "flip" | "drop">({
  name: "lamp",
  title: "Lamp",
  initial: "Off",
  finals: ["Broken"],
  transitions: [
    { from: "Off", event: "flip", to: "On", guard: "bulb fitted" },
    { from: "On", event: "flip", to: "Off" },
    { from: "On", event: "drop", to: "Broken" },
  ],
});

describe("state chart renderer", () => {
  it("draws the initial state, each transition with its guard, and the finals", () => {
    expect(renderMachine(lamp)).toBe(
      ["```mermaid", "stateDiagram-v2", "  [*] --> Off", "  Off --> On: flip [bulb fitted]", "  On --> Off: flip", "  On --> Broken: drop", "  Broken --> [*]", "```"].join("\n"),
    );
  });

  it("orders machines by name and gives each a heading", () => {
    const other = defineMachine<"A", "x">({ name: "alpha", title: "Alpha thing", initial: "A", finals: [], transitions: [] });
    const doc = renderDocument([lamp, other]);
    expect(doc.indexOf("## Alpha thing")).toBeLessThan(doc.indexOf("## Lamp"));
    expect(doc.startsWith("# State charts")).toBe(true);
  });

  it("is deterministic", async () => {
    const machines = await loadMachines();
    expect(renderDocument(machines)).toBe(renderDocument([...machines].reverse()));
  });
});
