import { describe, expect, it } from "vitest";
import { countRuns, failingTestNames, reviewOf, runsForPullRequest } from "../../tools/pipeline-metrics-lib.mjs";

describe("reviews", () => {
  it.each([
    ["## QA review\n\nVerdict: approve", "qa", "ok"],
    ["## QA review\n\n**Verdict: approve with changes**", "qa", "changes"],
    ["## Product review\n\nVerdict: send back", "product", "blocking"],
    ["## Security review (re-review, head 040686c)\n\n**Verdict: clear with fixes (1 low).**", "security", "changes"],
    ["## Security review\n\nVerdict: blocked", "security", "blocking"],
    ["## UX review (lead)\n\nVerdict: approve", "ux", "ok"],
    ["## UX review (phone) re-review\n\nVerdict: send back", "ux", "blocking"],
  ])("reads %j", (body, reviewer, outcome) => {
    expect(reviewOf(body)).toEqual({ reviewer, outcome });
  });

  it.each([
    "Review responses\n\nQA review said Verdict: send back",
    "## Review replies\n\nApplied: all",
    "Engineer reply to QA and security reviews\n\n## QA review\nVerdict: send back",
    "## Security review of the reply\n\nVerdict: clear",
  ])("does not count %j as a review", (body) => {
    expect(reviewOf(body)).toBeNull();
  });

  it("marks a verdict outside the standard words unknown", () => {
    expect(reviewOf("## QA review\n\nVerdict: ready with fixes")?.outcome).toBe("unknown");
    expect(reviewOf("## QA review\n\nVerdict: approved by nobody")?.outcome).toBe("unknown");
    expect(reviewOf("## Security review\n\nVerdict: approve")?.outcome).toBe("unknown");
  });
});

describe("failing test names", () => {
  const prefix = "e2e phone\tRun npx playwright test --project=phone\t2026-11-27T07:20:10.1334754Z";

  it("keeps the title and drops line and column, so the same test groups across runs", () => {
    const log = `${prefix}   1) [phone] › e2e/hidden-plan.spec.ts:13:1 › an Only me plan never shows its title\n${prefix}   2) [phone] › e2e/sign-out.spec.ts:4:1 › sign out`;
    expect(failingTestNames(log)).toEqual(["e2e/hidden-plan.spec.ts › an Only me plan never shows its title", "e2e/sign-out.spec.ts › sign out"]);
  });

  it("reports null for an empty log or a log without failing tests", () => {
    expect(failingTestNames("")).toBeNull();
    expect(failingTestNames(`${prefix}   Error: something else`)).toBeNull();
  });

  it("ignores lines that only contain the pattern, such as an assertion dump", () => {
    expect(failingTestNames(`${prefix}   expected "1) [phone] › secret › text" to be hidden`)).toBeNull();
    expect(failingTestNames("1) [phone] › e2e/x.spec.ts:1:1 › no prefix")).toBeNull();
  });

  it("caps the length of a name", () => {
    const log = `${prefix}   1) [phone] › e2e/x.spec.ts:1:1 › ${"a".repeat(500)}`;
    expect(failingTestNames(log)?.[0]).toHaveLength(200);
  });
});

describe("runs", () => {
  const runs = [
    { headSha: "a", conclusion: "success" },
    { headSha: "b", conclusion: "failure" },
    { headSha: "b", conclusion: "cancelled" },
    { headSha: "z", conclusion: "failure" },
  ];

  it("belongs to a pull request by head sha, not by branch name", () => {
    expect(runsForPullRequest(runs, ["a", "b"])).toHaveLength(3);
  });

  it("counts failures and cancellations apart", () => {
    expect(countRuns(runs)).toEqual({ total: 4, failures: 2, cancelled: 1 });
  });
});
