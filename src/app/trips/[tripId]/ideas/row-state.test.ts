import { describe, expect, it } from "vitest";
import type { IdeaState } from "./actions";
import { closesRow } from "./row-state";

const state = (over: Partial<IdeaState>): IdeaState => ({ status: null, error: null, undo: null, ...over });

describe("when the open row closes", () => {
  it("closes after an action that worked, with or without an undo", () => {
    expect(closesRow(state({ status: "Marked Buy gold as done." }))).toBe(true);
    expect(closesRow(state({ status: "Dropped Buy gold.", undo: { intent: "restore", ideaId: "x" } }))).toBe(true);
  });

  it("stays open when the action failed, so the form and what was typed stay next to the error", () => {
    expect(closesRow(state({ error: "The end is before the start." }))).toBe(false);
  });

  it("does nothing before anything was sent", () => {
    expect(closesRow(state({}))).toBe(false);
  });
});
