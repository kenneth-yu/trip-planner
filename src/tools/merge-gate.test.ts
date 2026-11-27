import { describe, expect, it } from "vitest";
import { evaluate, isIntegrationPath, isReply, parseVerdict, REQUIRED_CHECKS } from "../../tools/merge-gate-lib.mjs";

const T = (minute: number) => `2026-11-27T10:${String(minute).padStart(2, "0")}:00Z`;
const ME = "kenneth-yu";

interface Run {
  id: number;
  name: string;
  status: string;
  conclusion: string | null;
  appSlug: string;
}

interface Comment {
  author: string;
  authorType: string;
  body: string;
  updatedAt: string;
}

interface Commit {
  sha: string;
  parents: string[];
  committedAt: string;
}

const greenRuns: Run[] = REQUIRED_CHECKS.map((name, index) => ({ id: 100 + index, name, status: "completed", conclusion: "success", appSlug: "github-actions" }));

const say = (minute: number, body: string, author = ME, authorType = "User"): Comment => ({ author, authorType, body, updatedAt: T(minute) });

const reviews: Comment[] = [say(10, "## QA review\n\nVerdict: approve\n"), say(11, "## Security review\n\nVerdict: clear\n"), say(12, "## Product review\n\nVerdict: approve\n")];

const commit = (sha: string, minute: number, parents: string[] = ["p"]): Commit => ({ sha, parents, committedAt: T(minute) });

function pull(overrides: Record<string, unknown> = {}) {
  const files = [{ filename: "src/server/foo.ts" }];
  return {
    reviewerLogin: ME,
    files,
    changedFiles: files.length,
    comments: reviews,
    commits: [commit("a", 5)],
    checkRuns: greenRuns,
    behindBy: 0,
    mainAncestors: new Set<string>(),
    ...overrides,
  };
}

describe("verdict parsing", () => {
  it.each([
    ["## QA review\n\nVerdict: approve", "qa", "positive"],
    ["## QA review\n\n**Verdict: approve with changes**", "qa", "conditional"],
    ["## Security review\n\n**Verdict: clear with fixes (2 medium, 3 low).**", "security", "conditional"],
    ["## Security review (re-review, head 040686c)\n\n**Verdict: clear**", "security", "positive"],
    ["## Product review\n\nVerdict: send back", "product", "negative"],
    ["## UX review (lead)\n\nVerdict: approve", "ux", "positive"],
    ["## Security review\n\nVerdict: blocked", "security", "negative"],
  ])("reads %j", (body, reviewer, outcome) => {
    expect(parseVerdict(body)).toMatchObject({ reviewer, outcome });
  });

  it.each([
    ["QA with the security words", "## QA review\n\nVerdict: clear"],
    ["security with the QA words", "## Security review\n\nVerdict: approve"],
    ["non standard words", "## QA review\n\nVerdict: ready with fixes"],
    ["verdict not on the first body line", "## QA review\n\nSummary\n\nVerdict: approve"],
    ["prose that starts with a standard word", "## QA review\n\nVerdict: approved by nobody"],
    ["no verdict line", "## QA review\n\nLooks fine"],
  ])("does not treat %s as positive", (_name, body) => {
    expect(parseVerdict(body)?.outcome).toBe("unknown");
  });

  it("needs the standard heading as the first line", () => {
    expect(parseVerdict("Some text\n## QA review\n\nVerdict: approve")).toBeNull();
    expect(parseVerdict("QA review\n\nVerdict: approve")).toBeNull();
    expect(parseVerdict("## UX review\n\nVerdict: approve")).toBeNull();
    expect(parseVerdict("## UX review (phone)\n\nVerdict: approve")).toBeNull();
    expect(parseVerdict("Applied: everything")).toBeNull();
  });

  it("strips control characters from the verdict text", () => {
    expect(parseVerdict("## QA review\n\nVerdict: send back \u001b[31mred")?.text).toBe("send back [31mred");
  });
});

describe("replies", () => {
  it.each(["Applied: 1, 2", "1. Seed guard (medium): Applied.", "- Declined: out of scope", "**Applied** all of them"])("accepts %j", (body) => {
    expect(isReply(body)).toBe(true);
  });

  it.each(["Nothing was applied.", "I declined to comment", "## QA review\n\nVerdict: approve\nApplied"])("rejects %j", (body) => {
    expect(isReply(body)).toBe(false);
  });
});

describe("integration owned paths", () => {
  it.each([
    "drizzle/0008_x.sql",
    "drizzle.config.ts",
    "src/server/db/schema.ts",
    "src/app/trips/[tripId]/nav.tsx",
    "src/app/trips/[tripId]/layout.tsx",
    "src/proxy.ts",
    "package.json",
    "package-lock.json",
    "next.config.ts",
    "eslint.config.mjs",
    "vitest.config.mts",
    "playwright.config.ts",
    ".github/workflows/ci.yml",
    ".claude/agents/engineer.md",
    ".gitleaks.toml",
    "CLAUDE.md",
    "docs/PIPELINE.md",
    "tools/merge-gate.mjs",
    "tools/merge-gate-lib.mjs",
  ])("%s is integration owned", (path) => {
    expect(isIntegrationPath(path)).toBe(true);
  });

  it("leaves ordinary code and the security doc alone", () => {
    expect(isIntegrationPath("src/server/seed.ts")).toBe(false);
    expect(isIntegrationPath("src/app/page.tsx")).toBe(false);
    expect(isIntegrationPath("docs/SECURITY.md")).toBe(false);
    expect(isIntegrationPath("tools/pipeline-metrics.mjs")).toBe(false);
  });
});

describe("merge gate", () => {
  it("passes when checks are green, the branch has main, and every verdict is positive", () => {
    expect(evaluate(pull())).toEqual({ ok: true, reasons: [] });
  });

  describe("who may give a verdict", () => {
    it("ignores verdicts from a bot, a stranger or the wrong account", () => {
      const forged = reviews.map((c) => ({ ...c, author: "vercel[bot]", authorType: "Bot" }));
      expect(evaluate(pull({ comments: forged })).reasons).toEqual(["No QA review verdict on the pull request.", "No Security review verdict on the pull request.", "No Product review verdict on the pull request."]);
      const stranger = reviews.map((c) => ({ ...c, author: "someone-else" }));
      expect(evaluate(pull({ comments: stranger })).ok).toBe(false);
      const botWithMyName = reviews.map((c) => ({ ...c, authorType: "Bot" }));
      expect(evaluate(pull({ comments: botWithMyName })).ok).toBe(false);
    });

    it("does not let a forged send back from a stranger block, and does not let a forged approve unblock", () => {
      const forged = [say(30, "## QA review\n\nVerdict: send back", "someone-else"), ...reviews];
      expect(evaluate(pull({ comments: forged })).ok).toBe(true);
      const withSendBack = [...reviews.slice(1), say(10, "## QA review\n\nVerdict: send back"), say(20, "## QA review\n\nVerdict: approve", "someone-else")];
      expect(evaluate(pull({ comments: withSendBack })).reasons[0]).toMatch(/latest QA verdict is not positive/);
    });

    it("needs the heading on the first line", () => {
      const comments = [say(10, "Looks good\n## QA review\n\nVerdict: approve"), ...reviews.slice(1)];
      expect(evaluate(pull({ comments })).reasons).toEqual(["No QA review verdict on the pull request."]);
    });

    it("uses the edit time, so a send back edited into an approval is dated at the edit", () => {
      const edited = [{ ...reviews[0], updatedAt: T(40) }, ...reviews.slice(1)];
      const commits = [commit("a", 5), commit("b", 30)];
      expect(evaluate(pull({ commits, comments: edited })).reasons).toEqual([
        "The Security verdict is older than the head: code was pushed after it.",
        "The Product verdict is older than the head: code was pushed after it.",
      ]);
    });
  });

  describe("required checks", () => {
    it("names a required check that is red, pending or missing", () => {
      const runs = greenRuns.filter((r) => r.name !== "lint" && r.name !== "build").map((r) => (r.name === "test" ? { ...r, conclusion: "failure" } : r.name === "audit" ? { ...r, status: "in_progress", conclusion: null } : r));
      const text = evaluate(pull({ checkRuns: runs })).reasons.join("\n");
      expect(text).toMatch(/"lint" has not reported/);
      expect(text).toMatch(/"build" has not reported/);
      expect(text).toMatch(/"test" is not green \(failure\)/);
      expect(text).toMatch(/"audit" is not green \(in_progress\)/);
    });

    it("uses the newest run of a name, whatever its position in the list", () => {
      const rerun = [{ id: 500, name: "test", status: "completed", conclusion: "success", appSlug: "github-actions" }, { id: 50, name: "test", status: "completed", conclusion: "failure", appSlug: "github-actions" }];
      expect(evaluate(pull({ checkRuns: [...greenRuns.filter((r) => r.name !== "test"), ...rerun] })).ok).toBe(true);
      const regression = [{ id: 50, name: "test", status: "completed", conclusion: "success", appSlug: "github-actions" }, { id: 500, name: "test", status: "completed", conclusion: "failure", appSlug: "github-actions" }];
      expect(evaluate(pull({ checkRuns: [...greenRuns.filter((r) => r.name !== "test"), ...regression] })).reasons).toEqual(['Required check "test" is not green (failure).']);
    });

    it("ignores commit statuses and other apps that share a check name", () => {
      const status = { id: 900, name: "gitleaks", status: "completed", conclusion: "success", appSlug: "some-app" };
      const without = greenRuns.filter((r) => r.name !== "gitleaks");
      expect(evaluate(pull({ checkRuns: [...without, status] })).reasons).toEqual(['Required check "gitleaks" has not reported on the head.']);
      const failing = { id: 900, name: "gitleaks", status: "completed", conclusion: "failure", appSlug: "some-app" };
      expect(evaluate(pull({ checkRuns: [...greenRuns, failing] })).ok).toBe(true);
    });

    it("does not require checks outside the list", () => {
      expect(evaluate(pull({ checkRuns: [...greenRuns, { id: 1, name: "Vercel", status: "completed", conclusion: "failure", appSlug: "vercel" }] })).ok).toBe(true);
    });
  });

  describe("the branch and the file list", () => {
    it("refuses a branch behind main", () => {
      expect(evaluate(pull({ behindBy: 3 })).reasons).toEqual(["The branch is 3 commit(s) behind main. Merge origin/main into it."]);
    });

    it.each([undefined, null, "0", Number.NaN])("fails closed when behind_by is %j", (behindBy) => {
      expect(evaluate(pull({ behindBy })).reasons).toEqual(["Could not tell whether the branch is behind main."]);
    });

    it("refuses when the file list is shorter than the pull request says", () => {
      expect(evaluate(pull({ changedFiles: 120 })).reasons).toEqual(["Only 1 of 120 changed files could be read, so integration paths cannot be ruled out."]);
    });

    it("refuses any integration owned path, including the old name of a rename", () => {
      const files = [{ filename: "src/server/foo.ts" }, { filename: "docs/old-name.md", previousFilename: "drizzle/meta/_journal.json" }, { filename: "src/proxy.ts" }];
      const { reasons } = evaluate(pull({ files, changedFiles: 3 }));
      expect(reasons).toEqual(["The pull request touches integration-owned paths: drizzle/meta/_journal.json, src/proxy.ts. The architect merges it."]);
    });
  });

  describe("reviewers and the head", () => {
    it("needs a verdict from QA, security and product", () => {
      expect(evaluate(pull({ comments: [] })).reasons).toEqual(["No QA review verdict on the pull request.", "No Security review verdict on the pull request.", "No Product review verdict on the pull request."]);
    });

    it("uses the latest verdict per reviewer", () => {
      expect(evaluate(pull({ comments: [say(1, "## QA review\n\nVerdict: send back"), ...reviews] })).ok).toBe(true);
      expect(evaluate(pull({ comments: [...reviews, say(20, "## QA review\n\nVerdict: send back")] })).reasons[0]).toMatch(/latest QA verdict is not positive/);
    });

    it("requires the UX lead only when the pull request touches the interface", () => {
      const files = [{ filename: "src/app/trips/page.tsx" }];
      expect(evaluate(pull({ files, changedFiles: 1 })).reasons).toEqual(["No UX lead review verdict on the pull request."]);
      expect(evaluate(pull({ files: [{ filename: "src/styles/x.css" }], changedFiles: 1 })).reasons).toEqual(["No UX lead review verdict on the pull request."]);
      expect(evaluate(pull({ files, changedFiles: 1, comments: [...reviews, say(13, "## UX review (lead)\n\nVerdict: approve")] })).ok).toBe(true);
    });

    it("refuses a positive verdict older than the head", () => {
      const { reasons } = evaluate(pull({ commits: [commit("a", 5), commit("b", 30)] }));
      expect(reasons).toHaveLength(3);
      expect(reasons[0]).toMatch(/QA verdict is older than the head/);
    });

    it("excuses a later merge of main decided by its parents, never by its headline", () => {
      const merge = { sha: "m", parents: ["a", "main-tip"], committedAt: T(30) };
      expect(evaluate(pull({ commits: [commit("a", 5), merge], mainAncestors: new Set(["main-tip"]) })).ok).toBe(true);
      expect(evaluate(pull({ commits: [commit("a", 5), merge], mainAncestors: new Set() })).ok).toBe(false);
      const sneaky = { sha: "s", parents: ["a"], committedAt: T(30) };
      expect(evaluate(pull({ commits: [commit("a", 5), sneaky], mainAncestors: new Set(["a"]) })).ok).toBe(false);
      const sideBranch = { sha: "m2", parents: ["a", "unreviewed-branch"], committedAt: T(30) };
      expect(evaluate(pull({ commits: [commit("a", 5), sideBranch], mainAncestors: new Set(["main-tip"]) })).ok).toBe(false);
    });

    it("sees a commit whose committer date was set back, because dates only move forward in commit order", () => {
      const backdated = [commit("a", 5), commit("b", 30), commit("c", 2)];
      expect(evaluate(pull({ commits: backdated })).ok).toBe(false);
    });
  });

  describe("approve with changes", () => {
    const withChanges = [say(10, "## QA review\n\nVerdict: approve with changes"), say(11, "## Security review\n\nVerdict: clear with fixes"), reviews[2]];

    it("needs an Applied or Declined reply from the same account", () => {
      expect(evaluate(pull({ comments: withChanges })).reasons).toEqual([
        'The latest QA verdict asks for changes ("approve with changes") and no Applied/Declined reply follows it.',
        'The latest Security verdict asks for changes ("clear with fixes") and no Applied/Declined reply follows it.',
      ]);
      const strangers = [...withChanges, say(13, "Applied: all", "someone-else"), say(14, "Nothing was applied.")];
      expect(evaluate(pull({ comments: strangers })).ok).toBe(false);
    });

    it("passes when the engineer applies the fixes and then replies, with no new round from the reviewers who asked for changes", () => {
      const product = say(21, "## Product review\n\nVerdict: approve");
      const comments = [withChanges[0], withChanges[1], say(23, "QA: Applied 1 and 2, Declined 3.\nSecurity: Applied 1."), product];
      const commits = [commit("a", 5), commit("fix", 20)];
      expect(evaluate(pull({ comments, commits })).ok).toBe(true);
    });

    it("still needs a fresh positive verdict from a reviewer whose approval predates the fixes", () => {
      const comments = [...withChanges, say(23, "Applied: all")];
      const commits = [commit("a", 5), commit("fix", 20)];
      expect(evaluate(pull({ comments, commits })).reasons).toEqual(["The Product verdict is older than the head: code was pushed after it."]);
    });

    it("fails when code is pushed after the reply", () => {
      const comments = [...withChanges, say(23, "Applied: all")];
      const commits = [commit("a", 5), commit("fix", 20), commit("late", 25)];
      expect(evaluate(pull({ comments, commits })).reasons).toEqual([
        "The QA verdict is older than the head: code was pushed after the Applied/Declined reply.",
        "The Security verdict is older than the head: code was pushed after the Applied/Declined reply.",
        "The Product verdict is older than the head: code was pushed after it.",
      ]);
    });

    it("passes after pushes when a re-review from the diff comes after the head", () => {
      const comments = [...withChanges, say(23, "Applied: all"), say(31, "## QA review\n\nVerdict: approve\n\nFrom the diff."), say(31, "## Security review\n\nVerdict: clear"), say(31, "## Product review\n\nVerdict: approve")];
      const commits = [commit("a", 5), commit("fix", 20), commit("late", 25)];
      expect(evaluate(pull({ comments, commits })).ok).toBe(true);
    });
  });
});
