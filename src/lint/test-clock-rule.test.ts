import { ESLint } from "eslint";
import path from "node:path";
import { describe, expect, it } from "vitest";

const root = path.join(import.meta.dirname, "..", "..");
const eslint = new ESLint({ cwd: root, overrideConfigFile: path.join(root, "eslint.config.mjs") });

async function clockProblems(code: string, filePath: string): Promise<string[]> {
  const [result] = await eslint.lintText(code, { filePath: path.join(root, filePath), warnIgnored: false });
  return result.messages.filter((m) => m.ruleId === "no-restricted-syntax" && /frozen clock|perf\/|wall clock|fake timers/.test(m.message)).map((m) => m.message);
}

const TEST = "src/server/example.test.ts";

describe("the test clock lint rule", () => {
  it.each([
    ["Date.now()", "const a = Date.now();\nexport { a };"],
    ["globalThis.Date.now()", "const a = globalThis.Date.now();\nexport { a };"],
    ["new Date() with no arguments", "const a = new Date();\nexport { a };"],
    ["performance.now()", "const a = performance.now();\nexport { a };"],
    ["a timing assertion on a variable", "expect(elapsed).toBeLessThan(5);"],
    ["a timing assertion on a property", "expect(result.elapsedMs).toBeLessThanOrEqual(5);"],
    ["a duration assertion", "expect(duration).toBeLessThan(5);"],
  ])("flags %s in a unit test", async (_name, code) => {
    expect((await clockProblems(code, TEST)).length).toBeGreaterThan(0);
  });

  it.each([
    ["a dated instant", 'const a = new Date("2026-12-01T10:00:00Z");\nexport { a };'],
    ["a date from a number", "const a = new Date(0);\nexport { a };"],
    ["the frozen helpers", 'import { frozenNow, nowMs } from "@/testing/clock";\nexport const a = [frozenNow(), nowMs()];'],
    ["an ordinary comparison", "expect(count).toBeLessThan(3);"],
    ["a property that is not a timing", "expect(result.items).toBeLessThanOrEqual(3);"],
  ])("leaves %s alone", async (_name, code) => {
    expect(await clockProblems(code, TEST)).toEqual([]);
  });

  it("does not flag real clock use in perf/", async () => {
    expect(await clockProblems("const a = Date.now();\nconst b = performance.now();\nexpect(elapsed).toBeLessThan(5);\nexport { a, b };", "perf/example.test.ts")).toEqual([]);
  });

  it("does not flag files that are not tests, such as the clock helper", async () => {
    expect(await clockProblems("export const a = Date.now();", "src/testing/clock.ts")).toEqual([]);
  });
});
