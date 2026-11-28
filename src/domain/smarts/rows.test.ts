import { describe, expect, it } from "vitest";
import { arrangeRows, checkSources, rowKey, tipSources } from "./rows";

const check = { anchor: "a".repeat(16), kind: "risky_connection", sentence: "Tight: 55 min to change planes at HKG.", itemIds: ["f1", "f2"], why: "Why text" };
const tip = { anchor: "b".repeat(16), kind: "airport" as const, itemId: "f2", row: "flight" as const, line: "Leave the hotel by noon.", why: "Tip why" };

describe("one line per row", () => {
  it("puts a connection check under the second flight", () => {
    expect(checkSources([check])).toMatchObject([{ itemId: "f2", row: "flight", line: check.sentence }]);
  });

  it("puts a wrong time check under its plan, with the fix labels", () => {
    const found = checkSources([{ anchor: "c".repeat(16), kind: "wrong_time", sentence: "Dinner at 6:30am? Did you mean 6:30pm?", itemIds: ["p1"], why: "w", fix: { label: "Change to 6:30pm", done: "Changed to 6:30pm." } }]);
    expect(found[0]).toMatchObject({ itemId: "p1", row: "event", fix: { label: "Change to 6:30pm", done: "Changed to 6:30pm." } });
  });

  it("leaves other kinds of findings out", () => {
    expect(checkSources([{ ...check, kind: "late_arrival" }])).toEqual([]);
  });

  it("shows the check and says Also for the tip on the same row", () => {
    const rows = arrangeRows([...tipSources([tip]), ...checkSources([check])]);
    const row = rows.get(rowKey("f2", "flight"));
    expect(row?.main.source).toBe("check");
    expect(row?.also).toEqual(["Leave the hotel by noon."]);
  });

  it("keeps different rows apart", () => {
    const rows = arrangeRows(tipSources([tip, { ...tip, anchor: "d".repeat(16), itemId: "s1", row: "check_out", line: "Store bags" }]));
    expect([...rows.keys()].sort()).toEqual(["f2:flight", "s1:check_out"]);
  });
});
