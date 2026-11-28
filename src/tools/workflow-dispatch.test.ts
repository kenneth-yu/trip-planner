import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const read = (name: string) => readFileSync(path.join(process.cwd(), ".github", "workflows", name), "utf8");

function jobConditions(text: string): { job: string; condition: string }[] {
  const found: { job: string; condition: string }[] = [];
  let job = "";
  for (const line of text.split("\n")) {
    const header = line.match(/^ {2}([a-z][a-z-]*):\s*$/);
    if (header) job = header[1] ?? "";
    const condition = line.match(/^ {4}if:\s*(.*)$/);
    if (condition && job) found.push({ job, condition: condition[1] ?? "" });
  }
  return found;
}

describe("the checks the merge gate starts by hand on a branch", () => {
  it.each(["ci.yml", "security.yml"])("%s can be dispatched", (name) => {
    expect(read(name)).toMatch(/^ {2}workflow_dispatch:/m);
  });

  it.each(["ci.yml", "security.yml"])("%s: every job that is skipped for pull request reasons runs for any other event", (name) => {
    const conditions = jobConditions(read(name)).filter((c) => /pull_request/.test(c.condition));
    expect(conditions.length).toBeGreaterThan(0);
    for (const { job, condition } of conditions) {
      expect(condition, `${name} job ${job}`).toContain("github.event_name != 'pull_request' ||");
      expect(condition, `${name} job ${job}`).not.toContain("github.event_name == 'push'");
    }
  });

  it("the gate starts both workflows on the branch after it updates it", () => {
    const gate = readFileSync(path.join(process.cwd(), "tools", "merge-gate.mjs"), "utf8");
    expect(gate).toMatch(/update-branch[\s\S]*\["ci\.yml", "security\.yml"\][\s\S]*"--ref", branch/);
  });
});
