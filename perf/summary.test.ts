import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { isReportFile, lighthouseRows, parseReport, redirected, timingRow } from "./summary";

const recordedNames = [
  "localhost-trips_00000000_0000_4000_8300_000000000001-2026_11_27_08_04_42.report.html",
  "localhost-trips_00000000_0000_4000_8300_000000000001-2026_11_27_08_04_42.report.json",
  "localhost-trips_00000000_0000_4000_8300_000000000001_deadlines-2026_11_27_08_05_20.report.json",
  "localhost-trips_00000000_0000_4000_8300_000000000001_inbox-2026_11_27_08_05_56.report.json",
  "manifest.json",
  "assertion-results.json",
];

const report = parseReport(readFileSync("perf/fixtures/lighthouse.report.json", "utf8"));

describe("Lighthouse summary", () => {
  it("picks the report JSON files LHCI writes and nothing else", () => {
    expect(recordedNames.filter(isReportFile)).toEqual(recordedNames.filter((n) => n.endsWith(".report.json")));
    expect(recordedNames.filter(isReportFile)).toHaveLength(3);
  });

  it("renders a row with score, LCP, CLS and TBT, with the trip id replaced", () => {
    expect(lighthouseRows([report])).toEqual(["| /trips/:trip | 84 | 2036 ms | 0.000 | 615 ms | ok |"]);
  });

  it("notices a run that was bounced to another page", () => {
    expect(redirected(report)).toBe(false);
    expect(redirected({ ...report, finalDisplayedUrl: "http://localhost:3199/sign-in" })).toBe(true);
  });

  it("renders a measurement that was slower than the cap as failed, with its budget", () => {
    expect(timingRow({ name: "planCalendarImport/december", medianMs: null, budgetMs: 145, samples: 3, status: "slower than the cap" })).toBe("| planCalendarImport/december | slower than the cap (3 samples) | 145 ms | failed |");
    expect(timingRow({ name: "a", medianMs: 12.3456, budgetMs: 20, samples: 21 })).toBe("| a | 12.346 ms | 20 ms | ok |");
    expect(timingRow({ name: "a", medianMs: 30, budgetMs: 20, samples: 21 })).toBe("| a | 30.000 ms | 20 ms | over |");
  });
});
