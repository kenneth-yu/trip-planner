import { describe, expect, it } from "vitest";
import { evaluate, isIntegrationPath, parseVerdict, REQUIRED_CHECKS } from "../../tools/merge-gate-lib.mjs";

const T = (minute: number) => `2026-11-27T10:${String(minute).padStart(2, "0")}:00Z`;

interface Check {
  name: string;
  conclusion: string;
}

const greenChecks: Check[] = [...REQUIRED_CHECKS.map((name) => ({ name, conclusion: "SUCCESS" })), { name: "Vercel", conclusion: "FAILURE" }];

const reviews = [
  { createdAt: T(10), body: "## QA review\n\nVerdict: approve\n" },
  { createdAt: T(11), body: "## Security review\n\n**Verdict: clear. No findings.**\n" },
  { createdAt: T(12), body: "## Product review\n\n**Verdict: approve.**\n" },
];

function pull(overrides: Record<string, unknown> = {}) {
  return {
    files: [{ path: "src/server/foo.ts" }],
    comments: reviews,
    commits: [{ oid: "a", committedDate: T(5), messageHeadline: "Add foo" }],
    statusCheckRollup: greenChecks,
    behindBy: 0,
    ...overrides,
  };
}

describe("verdict parsing", () => {
  it.each([
    ["## QA review\n\nVerdict: approve", "qa", "positive"],
    ["## Security review\n\n**Verdict: clear with fixes (2 medium, 3 low).**", "security", "conditional"],
    ["## Product review\n\n**Verdict: ready with fixes.**", "product", "conditional"],
    ["## UX review (lead)\n\nVerdict: send back", "ux", "negative"],
    ["## QA review\n\n**Verdict: blocked** on a leak", "qa", "negative"],
    ["## QA review\n\nNo verdict here", "qa", "unknown"],
  ])("reads %j", (body, reviewer, outcome) => {
    expect(parseVerdict(body)).toMatchObject({ reviewer, outcome });
  });

  it("ignores comments that are not reviews, and a UX review that is not the lead", () => {
    expect(parseVerdict("Applied: everything")).toBeNull();
    expect(parseVerdict("## UX review\n\nVerdict: approve")).toBeNull();
  });
});

describe("integration owned paths", () => {
  it.each([
    "drizzle/0008_x.sql",
    "src/server/db/schema.ts",
    "src/app/trips/[tripId]/nav.tsx",
    "src/app/trips/[tripId]/layout.tsx",
    "package.json",
    "package-lock.json",
    "next.config.ts",
    "eslint.config.mjs",
    "vitest.config.mts",
    "playwright.config.ts",
    ".github/workflows/ci.yml",
    ".claude/agents/engineer.md",
    "CLAUDE.md",
    "docs/PIPELINE.md",
  ])("%s is integration owned", (path) => {
    expect(isIntegrationPath(path)).toBe(true);
  });

  it("leaves ordinary code alone", () => {
    expect(isIntegrationPath("src/server/seed.ts")).toBe(false);
    expect(isIntegrationPath("src/app/page.tsx")).toBe(false);
  });
});

describe("merge gate", () => {
  it("passes when checks are green, the branch has main, and every verdict is positive", () => {
    expect(evaluate(pull())).toEqual({ ok: true, reasons: [] });
  });

  it("names a required check that is red, pending or missing", () => {
    const rollup = greenChecks.filter((c) => c.name !== "lint").map((c) => (c.name === "test" ? { ...c, conclusion: "FAILURE" } : c));
    const { ok, reasons } = evaluate(pull({ statusCheckRollup: rollup.filter((c) => c.name !== "build") }));
    expect(ok).toBe(false);
    expect(reasons.join("\n")).toMatch(/"lint" has not reported/);
    expect(reasons.join("\n")).toMatch(/"test" is not green \(failure\)/);
    expect(reasons.join("\n")).toMatch(/"build" has not reported/);
  });

  it("does not require checks outside the list", () => {
    expect(evaluate(pull({ statusCheckRollup: greenChecks })).ok).toBe(true);
  });

  it("refuses a branch behind main", () => {
    expect(evaluate(pull({ behindBy: 3 })).reasons).toEqual(["The branch is 3 commit(s) behind main. Merge origin/main into it."]);
  });

  it("needs a verdict from QA, security and product", () => {
    const { reasons } = evaluate(pull({ comments: [] }));
    expect(reasons).toEqual(["No QA review verdict on the pull request.", "No Security review verdict on the pull request.", "No Product review verdict on the pull request."]);
  });

  it("uses the latest verdict per reviewer", () => {
    const comments = [{ createdAt: T(1), body: "## QA review\n\nVerdict: send back" }, ...reviews];
    expect(evaluate(pull({ comments })).ok).toBe(true);
    const later = [...reviews, { createdAt: T(20), body: "## QA review\n\nVerdict: send back" }];
    expect(evaluate(pull({ comments: later })).reasons[0]).toMatch(/latest QA verdict is not positive/);
  });

  it("counts a verdict with changes only once an Applied or Declined reply follows it", () => {
    const withChanges = [reviews[0], { createdAt: T(11), body: "## Security review\n\n**Verdict: clear with fixes (1 low).**" }, reviews[2]];
    expect(evaluate(pull({ comments: withChanges })).reasons[0]).toMatch(/no Applied\/Declined reply/);
    const answered = [...withChanges, { createdAt: T(13), body: "Security: Applied 1, Declined 2." }];
    expect(evaluate(pull({ comments: answered })).ok).toBe(true);
    const answeredBefore = [{ createdAt: T(9), body: "Applied everything" }, ...withChanges];
    expect(evaluate(pull({ comments: answeredBefore })).ok).toBe(false);
  });

  it("requires the UX lead only when the pull request touches the interface", () => {
    expect(evaluate(pull({ files: [{ path: "src/app/trips/page.tsx" }] })).reasons).toEqual(["No UX lead review verdict on the pull request."]);
    expect(evaluate(pull({ files: [{ path: "src/styles/x.css" }] })).reasons).toEqual(["No UX lead review verdict on the pull request."]);
    const withUx = [...reviews, { createdAt: T(13), body: "## UX review (lead)\n\nVerdict: approve" }];
    expect(evaluate(pull({ files: [{ path: "src/app/trips/page.tsx" }], comments: withUx })).ok).toBe(true);
  });

  it("refuses a verdict older than the head", () => {
    const commits = [
      { oid: "a", committedDate: T(5), messageHeadline: "Add foo" },
      { oid: "b", committedDate: T(30), messageHeadline: "Change foo" },
    ];
    const { reasons } = evaluate(pull({ commits }));
    expect(reasons).toHaveLength(3);
    expect(reasons[0]).toMatch(/QA verdict is older than the head: 1 commit/);
  });

  it("accepts an old verdict when later commits only merge main, or the verdict is from the diff", () => {
    const merges = [
      { oid: "a", committedDate: T(5), messageHeadline: "Add foo" },
      { oid: "b", committedDate: T(30), messageHeadline: "Merge remote-tracking branch 'origin/main' into wp/foo" },
    ];
    expect(evaluate(pull({ commits: merges })).ok).toBe(true);
    const changed = [
      { oid: "a", committedDate: T(5), messageHeadline: "Add foo" },
      { oid: "b", committedDate: T(30), messageHeadline: "Change foo" },
    ];
    const fromDiff = reviews.map((c) => ({ ...c, body: `${c.body}\nReviewed from the diff.` }));
    expect(evaluate(pull({ commits: changed, comments: fromDiff })).ok).toBe(true);
  });

  it("refuses any integration owned path and lists it", () => {
    const { ok, reasons } = evaluate(pull({ files: [{ path: "package.json" }, { path: "src/server/foo.ts" }, { path: ".github/workflows/ci.yml" }] }));
    expect(ok).toBe(false);
    expect(reasons).toEqual(["The pull request touches integration-owned paths: package.json, .github/workflows/ci.yml. The architect merges it."]);
  });
});
