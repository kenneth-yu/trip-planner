import { describe, expect, it } from "vitest";
import { evaluate, isIntegrationPath, isReplyTo, lastCodeCommit, parseVerdict, REQUIRED_CHECKS } from "../../tools/merge-gate-lib.mjs";

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
}

const greenRuns: Run[] = REQUIRED_CHECKS.map((name, index) => ({ id: 100 + index, name, status: "completed", conclusion: "success", appSlug: "github-actions" }));

const say = (minute: number, body: string, author = ME, authorType = "User"): Comment => ({ author, authorType, body, updatedAt: T(minute) });

const sha = (letter: string) => letter.repeat(40);
const at = (letter: string) => ` at ${sha(letter)}`;

const reviews: Comment[] = [
  say(10, `## QA review\n\nVerdict: approve${at("a")}\n`),
  say(11, `## Security review\n\nVerdict: clear${at("a")}\n`),
  say(12, `## Product review\n\nVerdict: approve${at("a")}\n`),
];

const commit = (letter: string, parents: string[] = ["p"]): Commit => ({ sha: sha(letter), parents });

function pull(overrides: Record<string, unknown> = {}) {
  const files = [{ filename: "src/server/foo.ts" }];
  return {
    reviewerLogin: ME,
    files,
    changedFiles: files.length,
    comments: reviews,
    commits: [commit("a")],
    checkRuns: greenRuns,
    behindBy: 0,
    verifiedMerges: new Set<string>(),
    lastCodePushedAt: Date.parse(T(5)),
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

  it("reads the reviewed commit from the verdict line", () => {
    expect(parseVerdict(`## QA review\n\nVerdict: approve at ${"0123456789abcdef".repeat(2)}01234567`)?.reviewedSha).toBe("0123456789abcdef".repeat(2) + "01234567");
    expect(parseVerdict("## QA review\n\n**Verdict: approve at 0123abc** and more")?.reviewedSha).toBe("0123abc");
    expect(parseVerdict("## QA review\n\nVerdict: approve")?.reviewedSha).toBeNull();
    expect(parseVerdict("## QA review\n\nVerdict: approve at abc")?.reviewedSha).toBeNull();
    expect(parseVerdict("## QA review\n\nVerdict: approve at ZZZZZZZZ")?.reviewedSha).toBeNull();
  });

  it("strips control characters from the verdict text", () => {
    expect(parseVerdict("## QA review\n\nVerdict: send back \u001b[31mred")?.text).toBe("send back [31mred");
  });
});

describe("replies", () => {
  it.each([
    ["qa", "QA: Applied 1 and 2, Declined 3."],
    ["security", "- Security: Applied 1."],
    ["product", "**Product**: declined, out of scope"],
    ["ux", "UX: Applied all"],
  ])("accepts a reply that names %s", (reviewer, body) => {
    expect(isReplyTo(reviewer, body)).toBe(true);
  });

  it("does not let a reply to one reviewer answer another", () => {
    expect(isReplyTo("qa", "Security: Applied the fixes.")).toBe(false);
    expect(isReplyTo("security", "QA: Applied 1.")).toBe(false);
  });

  it.each(["Applied: all", "Nothing was applied.", "QA: nothing to do", "## QA review\n\nVerdict: approve\nQA: Applied"])("rejects %j", (body) => {
    expect(isReplyTo("qa", body)).toBe(false);
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

    it("orders verdicts by edit time, so a send back edited in after an approval is the latest", () => {
      const edited = [...reviews, { ...say(5, "## QA review\n\nVerdict: send back"), updatedAt: T(40) }];
      expect(evaluate(pull({ comments: edited })).reasons[0]).toMatch(/latest QA verdict is not positive/);
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
      expect(evaluate(pull({ files, changedFiles: 1, comments: [...reviews, say(13, `## UX review (lead)\n\nVerdict: approve${at("a")}`)] })).ok).toBe(true);
    });

    it("needs the verdict to name the commit it reviewed", () => {
      const comments = [say(10, "## QA review\n\nVerdict: approve"), ...reviews.slice(1)];
      expect(evaluate(pull({ comments })).reasons).toEqual(['The QA verdict does not name the commit it reviewed. Use "Verdict: <word> at <sha>".']);
    });

    it("refuses a verdict that names a commit that is not in the pull request", () => {
      const comments = [say(10, `## QA review\n\nVerdict: approve${at("9")}`), ...reviews.slice(1)];
      expect(evaluate(pull({ comments })).reasons).toEqual(["The QA verdict names a commit that is not in this pull request."]);
    });

    it("refuses a verdict on an earlier commit when code was pushed after it, whatever the dates say", () => {
      const commits = [commit("b"), commit("a")];
      const stale = reviews.map((c) => ({ ...c, body: c.body.replace(at("a"), at("b")), updatedAt: T(50) }));
      const { reasons } = evaluate(pull({ commits, comments: stale }));
      expect(reasons).toHaveLength(3);
      expect(reasons[0]).toMatch(/QA verdict is older than the head: it reviewed bbbbbbb and code was pushed after it/);
    });

    it("accepts a verdict on an earlier commit when only verified merges of main follow", () => {
      const merge = { sha: sha("m"), parents: [sha("a"), "main-tip"] };
      const comments = reviews;
      expect(evaluate(pull({ commits: [commit("a"), merge], comments, verifiedMerges: new Set([sha("m")]) })).ok).toBe(true);
    });

    it("does not excuse a merge that is not verified, such as one that changes more than merging its parents", () => {
      const evil = { sha: sha("e"), parents: [sha("a"), "main-tip"] };
      expect(evaluate(pull({ commits: [commit("a"), evil], verifiedMerges: new Set() })).ok).toBe(false);
      const fakeParents = { sha: sha("f"), parents: [sha("a")] };
      expect(evaluate(pull({ commits: [commit("a"), fakeParents], verifiedMerges: new Set([sha("f")]) })).ok).toBe(false);
    });

    it("finds the last code commit by skipping verified merges", () => {
      const merge = { sha: sha("m"), parents: [sha("a"), "main-tip"] };
      expect(lastCodeCommit([commit("a"), merge], new Set([sha("m")]))?.sha).toBe(sha("a"));
      expect(lastCodeCommit([commit("a"), merge], new Set())?.sha).toBe(sha("m"));
      expect(lastCodeCommit([merge], new Set([sha("m")]))).toBeNull();
    });
  });

  describe("approve with changes", () => {
    const withChanges = [say(10, `## QA review\n\nVerdict: approve with changes${at("a")}`), say(11, `## Security review\n\nVerdict: clear with fixes${at("a")}`), reviews[2]];

    it("needs a reply that names the reviewer it answers", () => {
      expect(evaluate(pull({ comments: withChanges })).reasons).toEqual([
        'The latest QA verdict asks for changes ("approve with changes at aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa") and no reply naming QA with Applied or Declined follows it.'.replace("aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", sha("a")),
        'The latest Security verdict asks for changes ("clear with fixes at aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa") and no reply naming Security with Applied or Declined follows it.'.replace("aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", sha("a")),
      ]);
      const wrongName = [...withChanges, say(13, "Security: Applied the fixes.")];
      expect(evaluate(pull({ comments: wrongName })).reasons).toHaveLength(1);
      const strangers = [...withChanges, say(13, "QA: Applied all", "someone-else"), say(14, "Nothing was applied.")];
      expect(evaluate(pull({ comments: strangers })).reasons).toHaveLength(2);
    });

    it("passes when the engineer applies the fixes and replies after the code was pushed", () => {
      const product = say(21, `## Product review\n\nVerdict: approve${at("b")}`);
      const comments = [withChanges[0], withChanges[1], product, say(23, "QA: Applied 1 and 2, Declined 3.\nSecurity: Applied 1.")];
      const commits = [commit("a"), commit("b")];
      expect(evaluate(pull({ comments, commits, lastCodePushedAt: Date.parse(T(20)) })).ok).toBe(true);
    });

    it("fails when code is pushed after the reply, by GitHub's clock", () => {
      const product = say(21, `## Product review\n\nVerdict: approve${at("c")}`);
      const comments = [withChanges[0], withChanges[1], product, say(23, "QA: Applied all\nSecurity: Applied all")];
      const commits = [commit("a"), commit("b"), commit("c")];
      expect(evaluate(pull({ comments, commits, lastCodePushedAt: Date.parse(T(25)) })).reasons).toEqual([
        "The QA verdict is older than the head: code was pushed after the Applied/Declined reply.",
        "The Security verdict is older than the head: code was pushed after the Applied/Declined reply.",
      ]);
    });

    it("fails closed when the time of the latest code push is unknown", () => {
      const product = say(21, `## Product review\n\nVerdict: approve${at("b")}`);
      const comments = [withChanges[0], withChanges[1], product, say(23, "QA: Applied all\nSecurity: Applied all")];
      const commits = [commit("a"), commit("b")];
      expect(evaluate(pull({ comments, commits, lastCodePushedAt: null })).reasons[0]).toMatch(/Could not tell when the latest code was pushed/);
    });

    it("needs no time check when the verdict reviewed the latest code", () => {
      const comments = [...withChanges, say(23, "QA: Applied all\nSecurity: Applied all")];
      expect(evaluate(pull({ comments, lastCodePushedAt: null })).ok).toBe(true);
    });
  });
});
