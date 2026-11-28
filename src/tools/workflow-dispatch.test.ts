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

describe("the checks that can be started by hand on a branch", () => {
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

  it("the merge gate workflow hands the gate token to the script and holds no more than it needs", () => {
    const text = read("merge-gate.yml");
    expect(text).toContain("GATE_TOKEN: ${{ secrets.GATE_TOKEN }}");
    expect(text).toMatch(/permissions:\n {2}contents: read\n {2}pull-requests: write\n/);
    expect(text).not.toMatch(/actions: write|contents: write/);
  });

  it("the merge gate queues only the runs whose job will run: concurrency is on the job, not the workflow", () => {
    const text = read("merge-gate.yml");
    expect(text).not.toMatch(/^concurrency:/m);
    expect(text).toMatch(/^ {4}concurrency:\n {6}group: merge-gate\n {6}cancel-in-progress: false\n/m);
  });

  it("the merge gate does not run on every push, and event runs wait for a burst to settle", () => {
    const text = read("merge-gate.yml");
    expect(text).not.toContain("synchronize");
    expect(text).toMatch(/if: github\.event_name != 'schedule' && github\.event_name != 'workflow_dispatch'\n {8}run: sleep 60/);
  });
});
