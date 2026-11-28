import { describe, expect, it } from "vitest";
import type { ActivityLine } from "@/server/services/activity-service";
import { groupLines } from "./describe";

const line = (kind: ActivityLine["kind"], by: string): ActivityLine => ({ id: kind, at: "2026-11-28T12:00:00.000Z", kind, by, title: "Buy gold", itemId: null, changed: [], via: null, count: null, source: null, canUndo: false, undid: null });
const sentence = (kind: ActivityLine["kind"], by: string) => {
  const row = groupLines([line(kind, by)], Date.parse("2026-11-28T15:00:00Z"), "America/New_York")[0]?.rows[0];
  return row ? `${row.sentence.lead}${row.sentence.title}${row.sentence.tail}` : "";
};

describe("the lines about ideas", () => {
  it.each([
    ["idea_scheduled", "Kenneth scheduled Buy gold."],
    ["idea_done", "Kenneth marked Buy gold as done."],
    ["idea_dropped", "Kenneth dropped Buy gold."],
    ["idea_reopened", "Kenneth brought back Buy gold."],
  ] as const)("%s reads %j, and cannot be undone from the log", (kind, text) => {
    expect(sentence(kind, "Kenneth")).toBe(text);
    const row = groupLines([line(kind, "Kenneth")], 0, "UTC")[0]?.rows[0];
    expect(row?.canUndo).toBe(false);
  });
});
