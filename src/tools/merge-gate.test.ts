import { describe, expect, it } from "vitest";
import { buildInput, changesApp, evaluate, GateDataError, isDocsOnly, isIntegrationPath, isReplyTo, lastCodeCommit, parseVerdict, pushEventTime, pushStart, REPLY_FORMAT, REQUIRED_CHECKS, requiredReviewers, semverOf, touchesOwnerOnly, touchesWorkflowFiles, isWorkflowRefusal, WORKFLOW_REASON } from "../../tools/merge-gate-lib.mjs";

const T = (minute: number) => `2026-11-27T10:${String(minute).padStart(2, "0")}:00Z`;
const ME = "kenneth-yu";
const REPO = "kenneth-yu/trip-planner";

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

const greenRuns: Run[] = REQUIRED_CHECKS.map((name: string, index: number) => ({ id: 100 + index, name, status: "completed", conclusion: "success", appSlug: "github-actions" }));

const say = (minute: number, body: string, author = ME, authorType = "User"): Comment => ({ author, authorType, body, updatedAt: T(minute) });

const sha = (letter: string) => letter.repeat(40);
const at = (letter: string) => ` at ${sha(letter)}`;

const reviews: Comment[] = [
  say(10, `## QA review\n\nVerdict: approve${at("a")}\n`),
  say(11, `## Security review\n\nVerdict: clear${at("a")}\n`),
  say(12, `## Product review\n\nVerdict: approve${at("a")}\n`),
];

const commit = (letter: string, parents: string[] = ["p"]): Commit => ({ sha: sha(letter), parents });

const noLabels: string[] = [];

function pull(overrides: Record<string, unknown> = {}) {
  const files = [{ filename: "src/server/services/foo.ts" }];
  return {
    reviewerLogin: ME,
    labels: noLabels,
    body: "Summary\n\nSemver: patch\n",
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
    expect(evaluate(pull())).toMatchObject({ ok: true, reasons: [], behind: false, needsOwner: false, held: false });
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
      const runs = greenRuns.filter((r) => r.name !== "static" && r.name !== "prod-build").map((r) => (r.name === "test" ? { ...r, conclusion: "failure" } : r.name === "postgres" ? { ...r, status: "in_progress", conclusion: null } : r));
      const text = evaluate(pull({ checkRuns: runs })).reasons.join("\n");
      expect(text).toMatch(/"static" has not reported/);
      expect(text).toMatch(/"prod-build" has not reported/);
      expect(text).toMatch(/"test" is not green \(failure\)/);
      expect(text).toMatch(/"postgres" is not green \(in_progress\)/);
    });

    it("counts a skipped check as passing and anything else that is not a success as failing", () => {
      const skipped = greenRuns.map((r) => (r.name === "static" || r.name === "prod-build" ? { ...r, conclusion: "skipped" } : r));
      expect(evaluate(pull({ checkRuns: skipped })).ok).toBe(true);
      for (const conclusion of ["cancelled", "timed_out", "neutral", "action_required", "stale"]) {
        const bad = greenRuns.map((r) => (r.name === "static" ? { ...r, conclusion } : r));
        expect(evaluate(pull({ checkRuns: bad })).reasons).toEqual([`Required check "static" is not green (${conclusion}).`]);
      }
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
    it("reports a branch behind main as a state, not a failure, so the gate can update it", () => {
      const verdict = evaluate(pull({ behindBy: 3 }));
      expect(verdict).toMatchObject({ ok: true, behind: true, reasons: [] });
    });

    it.each([undefined, null, "0", Number.NaN])("fails closed when behind_by is %j", (behindBy) => {
      const verdict = evaluate(pull({ behindBy }));
      expect(verdict.ok).toBe(false);
      expect(verdict.reasons).toEqual(["Could not tell whether the branch is behind main."]);
    });

    it("refuses when the file list is shorter than the pull request says", () => {
      expect(evaluate(pull({ changedFiles: 120 })).reasons).toEqual(["Only 1 of 120 changed files could be read, so the reviewers it needs cannot be worked out."]);
    });
  });

  describe("integration paths and the owner", () => {
    const architect = (minute: number, word = "approve") => say(minute, `## Architect review\n\nVerdict: ${word}${at("a")}`);

    it("needs an architect verdict, including for the old name of a rename", () => {
      const files = [{ filename: "src/server/services/foo.ts" }, { filename: "docs/old-name.md", previousFilename: "drizzle/meta/_journal.json" }];
      expect(evaluate(pull({ files, changedFiles: 2 })).reasons).toEqual(["No Architect review verdict on the pull request."]);
      expect(evaluate(pull({ files, changedFiles: 2, comments: [...reviews, architect(13)] })).ok).toBe(true);
      expect(evaluate(pull({ files, changedFiles: 2, comments: [...reviews, architect(13, "send back")] })).reasons[0]).toMatch(/latest Architect verdict is not positive/);
    });

    it("does not need an architect verdict for an ordinary change", () => {
      expect(requiredReviewers(["src/server/services/foo.ts"])).not.toContain("architect");
    });

    it("never merges .claude or CLAUDE.md, and flags the pull request for the owner", () => {
      for (const filename of [".claude/agents/qa-reviewer.md", "CLAUDE.md"]) {
        const files = [{ filename }];
        const verdict = evaluate(pull({ files, changedFiles: 1, comments: [...reviews, architect(13)] }));
        expect(verdict.ok).toBe(false);
        expect(verdict.needsOwner).toBe(true);
        expect(verdict.reasons).toContain("The pull request touches .claude/ or CLAUDE.md, which only the owner may merge.");
      }
      expect(touchesOwnerOnly(["src/a.ts"])).toBe(false);
    });
  });

  describe("workflow files", () => {
    it("are recognised by their new or old name", () => {
      expect(touchesWorkflowFiles([".github/workflows/ci.yml"])).toBe(true);
      expect(touchesWorkflowFiles(["docs/x.md", ".github/workflows/deep/x.yaml"])).toBe(true);
      expect(touchesWorkflowFiles([".github/CODEOWNERS", "tools/ci/x.mjs", "src/a.ts"])).toBe(false);
    });

    it("always need the owner, however many verdicts and green checks there are", () => {
      const architect = say(13, `## Architect review\n\nVerdict: approve${at("a")}`);
      for (const files of [[{ filename: ".github/workflows/ci.yml" }], [{ filename: "docs/old.md", previousFilename: ".github/workflows/ci.yml" }]]) {
        const verdict = evaluate(pull({ files, changedFiles: files.length, comments: [...reviews, architect] }));
        expect(verdict.ok).toBe(false);
        expect(verdict.needsOwner).toBe(true);
        expect(verdict.reasons).toContain(WORKFLOW_REASON);
      }
      expect(WORKFLOW_REASON).toBe("The pull request touches workflow files: needs the owner to merge.");
    });

    it("recognises the refusal GitHub gives a token without the workflows permission", () => {
      expect(isWorkflowRefusal("refusing to allow a Personal Access Token to create or update workflow `.github/workflows/ci.yml` without `workflow` scope")).toBe(true);
      expect(isWorkflowRefusal("Resource not accessible by personal access token: cannot modify .github/workflows/ci.yml")).toBe(true);
      expect(isWorkflowRefusal("Required status check \"test\" is expected.")).toBe(false);
      expect(isWorkflowRefusal("")).toBe(false);
    });
  });

  describe("labels", () => {
    it.each(["hold", "do-not-merge", "needs-owner"])("stops on the %s label", (label) => {
      const verdict = evaluate(pull({ labels: [label] }));
      expect(verdict.ok).toBe(false);
      expect(verdict.held).toBe(true);
      expect(verdict.reasons[0]).toContain(label);
    });

    it("ignores unrelated labels", () => {
      expect(evaluate(pull({ labels: ["perf", "holding"] })).ok).toBe(true);
    });
  });

  describe("semver", () => {
    it("ignores a Semver line inside a code fence", () => {
      expect(semverOf("```\nSemver: major\n```\nSemver: patch")).toEqual({ level: "patch", problem: null });
      expect(semverOf("~~~\nSemver: major\n~~~")).toEqual({ level: null, problem: "has no Semver line" });
    });

    it.each([["Semver: major", "major"], ["semver: Minor", "minor"], ["Notes\n\nSemver: patch  \n", "patch"]])("reads %j", (body, level) => {
      expect(semverOf(body)).toEqual({ level, problem: null });
    });

    it.each([["", "has no Semver line"], [null, "has no Semver line"], ["Semver: patch\nSemver: minor", "has more than one Semver line"], ["Semver: huge", "has a Semver line that is not major, minor or patch"], ["Semver:", "has a Semver line that is not major, minor or patch"]])("refuses %j", (body, problem) => {
      expect(semverOf(body)).toEqual({ level: null, problem });
    });

    it("is required for a pull request that changes the app and not for tooling, docs or tests", () => {
      expect(changesApp(["src/app/page.tsx"])).toBe(true);
      expect(changesApp(["public/icon.svg", "package.json"])).toBe(true);
      expect(changesApp(["src/server/a.test.ts", "e2e/a.spec.ts", "tools/x.mjs", ".github/workflows/ci.yml", "docs/UX.md"])).toBe(false);
      expect(evaluate(pull({ body: "no version here" })).reasons).toEqual(['The pull request body has no Semver line. A pull request that changes the app needs exactly one line "Semver: major", "Semver: minor" or "Semver: patch".']);
      expect(evaluate(pull({ body: "Semver: patch\nSemver: minor" })).ok).toBe(false);
      const tooling = [{ filename: "tools/x.mjs" }];
      expect(evaluate(pull({ files: tooling, changedFiles: 1, body: "" })).ok).toBe(true);
    });
  });

  describe("which reviewers a pull request needs", () => {
    it.each([
      [["docs/UX.md", "README.md", ".pipeline/status.md"], []],
      [["tools/x.mjs"], ["qa"]],
      [["e2e/a.spec.ts"], ["qa"]],
      [["src/app/trips/x.module.css"], ["qa", "ux"]],
      [["src/app/trips/page.tsx"], ["qa", "product", "ux"]],
      [["src/app/trips/actions.ts"], ["qa", "security", "product"]],
      [["src/server/services/a.ts"], ["qa", "security", "product"]],
      [["src/server/auth/adapter.ts"], ["qa", "security"]],
      [["src/server/security/headers.ts"], ["qa", "security"]],
      [["src/domain/a.ts"], ["qa", "product"]],
      [["public/icon.svg"], ["qa", "ux"]],
      [["src/app/manifest.ts"], ["qa", "product", "ux"]],
      [["package.json"], ["qa", "security", "architect"]],
      [[".github/workflows/ci.yml"], ["qa", "security", "architect"]],
      [["src/server/services/a.test.ts"], ["qa"]],
      [["docs/STATECHARTS.md"], ["qa"]],
      [["docs/PIPELINE.md"], ["qa", "architect"]],
      [["docs/SECURITY.md"], ["qa", "security"]],
      [["tools/ci/vercel-ignore.sh"], ["qa", "security", "architect"]],
      [["tools/merge-gate-lib.mjs"], ["qa", "security", "architect"]],
      [["next.config.ts"], ["qa", "security", "architect"]],
      [["vercel.json"], ["qa", "security", "architect"]],
    ])("%j needs %j", (paths, expected) => {
      expect([...requiredReviewers(paths)].sort()).toEqual([...expected].sort());
    });

    it("treats documentation only as docs only", () => {
      expect(isDocsOnly(["docs/UX.md", "docs/STATECHARTS.md"])).toBe(false);
      expect(isDocsOnly(["src/server/x.md"])).toBe(false);
      expect(isDocsOnly([])).toBe(false);
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

  describe("the push event of the last code", () => {
    const events = [
      { event: "committed", sha: sha("a"), committer: { date: "2026-11-27T09:00:00Z" } },
      { event: "committed", sha: sha("b"), committer: { date: "2026-11-27T10:00:00Z" } },
      { event: "head_ref_force_pushed", commit_id: sha("b"), created_at: "2026-11-27T10:05:00Z" },
    ];

    it("takes the latest event that is about the commit", () => {
      expect(pushEventTime(events, sha("b"))).toBe(Date.parse("2026-11-27T10:05:00Z"));
      expect(pushEventTime(events, sha("a"))).toBe(Date.parse("2026-11-27T09:00:00Z"));
    });

    it("prefers the time GitHub recorded over the commit date", () => {
      const recorded = [{ event: "committed", sha: sha("a"), created_at: "2026-11-27T11:00:00Z", committer: { date: "2026-11-27T09:00:00Z" } }];
      expect(pushEventTime(recorded, sha("a"))).toBe(Date.parse("2026-11-27T11:00:00Z"));
    });

    it("is null when no event is about the commit or the time is unreadable", () => {
      expect(pushEventTime(events, sha("z"))).toBeNull();
      expect(pushEventTime([{ event: "committed", sha: sha("a"), committer: { date: "never" } }], sha("a"))).toBeNull();
      expect(pushEventTime([{ event: "committed", sha: sha("a") }], sha("a"))).toBeNull();
    });
  });

  describe("when the last code was pushed", () => {
    const runs = (startedAt: string) => [{ started_at: startedAt }, { started_at: "2026-11-27T12:00:00Z" }];
    const commits = [commit("a"), { sha: sha("m"), parents: [sha("a"), "main-tip"] }, { sha: sha("n"), parents: [sha("m"), "main-tip"] }];
    const asked: string[] = [];
    const lookup = (table: Record<string, Array<{ started_at: string }>>) => (at: string) => {
      asked.push(at);
      return table[at] ?? [];
    };

    it("is the earliest check start of the code commit itself when it ran", () => {
      asked.length = 0;
      expect(pushStart(commits, sha("a"), lookup({ [sha("a")]: runs("2026-11-27T10:00:00Z") }))).toBe(Date.parse("2026-11-27T10:00:00Z"));
      expect(asked).toEqual([sha("a")]);
    });

    it("is the checks of the merge commit it was pushed with, when the code commit has no runs of its own", () => {
      asked.length = 0;
      expect(pushStart(commits, sha("a"), lookup({ [sha("m")]: runs("2026-11-27T11:00:00Z") }))).toBe(Date.parse("2026-11-27T11:00:00Z"));
      expect(asked).toEqual([sha("a"), sha("m")]);
    });

    it("walks on to the first later commit that has runs, not further, and never back before the code commit", () => {
      asked.length = 0;
      expect(pushStart(commits, sha("m"), lookup({ [sha("a")]: runs("2026-11-27T09:00:00Z"), [sha("n")]: runs("2026-11-27T11:30:00Z") }))).toBe(Date.parse("2026-11-27T11:30:00Z"));
      expect(asked).toEqual([sha("m"), sha("n")]);
    });

    it("is null, so the gate fails closed, when no commit from the code commit to the head has runs", () => {
      expect(pushStart(commits, sha("a"), () => [])).toBeNull();
      expect(pushStart(commits, sha("a"), lookup({ [sha("a")]: [{ started_at: "never" }] }))).toBeNull();
    });

    it("is null when the code commit is not in the list", () => {
      expect(pushStart(commits, sha("z"), () => runs("2026-11-27T10:00:00Z"))).toBeNull();
    });
  });

  describe("verdicts that carry over a merge of main", () => {
    const plain = { sha: sha("m"), parents: [sha("a"), "main-tip"] };
    const conflict = { sha: sha("c"), parents: [sha("a"), "main-tip"] };
    const architectAt = (letter: string, minute = 14) => say(minute, `## Architect review\n\nVerdict: approve${at(letter)}`);

    it("carries every role's verdict over a merge of main that left the pull request's own diff unchanged", () => {
      const verdict = evaluate(pull({ commits: [commit("a"), plain], verifiedMerges: new Set([sha("m")]) }));
      expect(verdict.ok).toBe(true);
    });

    it("needs only a fresh Architect verdict, and not every role again, after a merge that resolved a conflict", () => {
      const commits = [commit("a"), conflict];
      const conflictMerges = new Set([sha("c")]);
      const without = evaluate(pull({ commits, conflictMerges }));
      expect(without.ok).toBe(false);
      expect(without.reasons).toEqual(["A merge of main resolved a conflict and changed this pull request's own diff since QA, Security, Product reviewed it. The Architect needs a fresh verdict at or after that merge; the others carry over."]);
      expect(evaluate(pull({ commits, conflictMerges, comments: [...reviews, architectAt("c")] })).ok).toBe(true);
    });

    it("does not take an Architect verdict from before the merge that resolved the conflict", () => {
      const verdict = evaluate(pull({ commits: [commit("a"), conflict], conflictMerges: new Set([sha("c")]), comments: [...reviews, architectAt("a")] }));
      expect(verdict.ok).toBe(false);
      expect(verdict.reasons[0]).toMatch(/needs a fresh verdict/);
    });

    it("asks the Architect again when the pull request already needs one and its verdict is from before the conflict merge", () => {
      const files = [{ filename: "package.json" }];
      const verdict = evaluate(pull({ files, changedFiles: 1, commits: [commit("a"), conflict], conflictMerges: new Set([sha("c")]), comments: [...reviews, architectAt("a")] }));
      expect(verdict.reasons).toContain("The Architect verdict is older than the head: a merge of main resolved a conflict after it, so the Architect needs to review again at or after that merge.");
    });

    it("still needs a full re-review when code was pushed after the verdict, even next to a merge of main", () => {
      const verdict = evaluate(pull({ commits: [commit("a"), plain, commit("b")], verifiedMerges: new Set([sha("m")]), comments: [...reviews, architectAt("b")] }));
      expect(verdict.ok).toBe(false);
      expect(verdict.reasons).toHaveLength(3);
      expect(verdict.reasons[0]).toMatch(/older than the head/);
      const mixed = evaluate(pull({ commits: [commit("a"), conflict, commit("b")], conflictMerges: new Set([sha("c")]), comments: [...reviews, architectAt("b")] }));
      expect(mixed.reasons).toHaveLength(3);
    });

    it("does not treat a merge from somewhere other than main as a merge of main", () => {
      const verdict = evaluate(pull({ commits: [commit("a"), { sha: sha("o"), parents: [sha("a"), sha("z")] }] }));
      expect(verdict.ok).toBe(false);
    });

    it("carries a changes-requested verdict, with its reply, over a conflict merge when the Architect is fresh", () => {
      const withChanges = [say(10, `## QA review\n\nVerdict: approve with changes${at("a")}`), say(11, `## Security review\n\nVerdict: clear${at("a")}`), say(12, `## Product review\n\nVerdict: approve${at("a")}`), say(13, "QA: Applied 1 and 2.")];
      const commits = [commit("a"), conflict];
      const conflictMerges = new Set([sha("c")]);
      expect(evaluate(pull({ commits, conflictMerges, comments: withChanges })).ok).toBe(false);
      expect(evaluate(pull({ commits, conflictMerges, comments: [...withChanges, architectAt("c", 20)] })).ok).toBe(true);
    });

    it("says it is approved, not blocked, so a behind pull request can be updated while its checks are not green", () => {
      const red = greenRuns.map((run, index) => (index === 0 ? { ...run, conclusion: "failure" } : run));
      const verdict = evaluate(pull({ checkRuns: red, behindBy: 2 }));
      expect(verdict.ok).toBe(false);
      expect(verdict.approved).toBe(true);
      expect(verdict.behind).toBe(true);
      expect(evaluate(pull({ checkRuns: red, behindBy: 2, comments: [] })).approved).toBe(false);
    });
  });

  describe("lenient replies", () => {
    it.each([
      ["QA: Applied 1 and 2, Declined 3."],
      ["QA\nApplied 1 and 2"],
      ["QA:\nApplied 1, 2"],
      ["QA:\n\nDeclined 3 because it is out of scope"],
      ["- **QA**:\n- Applied 1"],
      ["Thanks for the review.\nQA: Applied 1 and 2.\nSecurity: Declined 1."],
      ["QA — Declined 2"],
    ])("reads %j as a reply to QA", (body) => {
      expect(isReplyTo("qa", body)).toBe(true);
    });

    it.each([
      ["QA is reviewing it now"],
      ["QA\n\nSecurity: Applied 1"],
      ["Applied 1 and 2"],
      ["QA looked at it. We will see.\nSomeone else: Applied 1"],
      ["## QA review\n\nVerdict: approve\nApplied nothing"],
    ])("does not read %j as a reply to QA", (body) => {
      expect(isReplyTo("qa", body)).toBe(false);
    });

    it("tells the person the exact format when it refuses", () => {
      const comments = [say(10, `## QA review\n\nVerdict: approve with changes${at("a")}`), reviews[1], reviews[2]];
      const reasons = evaluate(pull({ comments })).reasons;
      expect(reasons).toHaveLength(1);
      expect(reasons[0]).toContain('Name the role, then Applied or Declined, on one line or on two lines in a row, for example "QA: Applied 1 and 2, Declined 3."');
    });

    it("passes when the reply is split over two lines", () => {
      const comments = [say(10, `## QA review\n\nVerdict: approve with changes${at("a")}`), reviews[1], reviews[2], say(20, "QA:\nApplied 1, 2")];
      expect(evaluate(pull({ comments })).ok).toBe(true);
    });
  });

  describe("approve with changes", () => {
    const withChanges = [say(10, `## QA review\n\nVerdict: approve with changes${at("a")}`), say(11, `## Security review\n\nVerdict: clear with fixes${at("a")}`), reviews[2]];

    it("needs a reply that names the reviewer it answers", () => {
      expect(evaluate(pull({ comments: withChanges })).reasons).toEqual([
        'The latest QA verdict asks for changes ("approve with changes at aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa") and no reply naming QA with Applied or Declined follows it.'.replace("aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", sha("a")) + ` ${REPLY_FORMAT}`,
        'The latest Security verdict asks for changes ("clear with fixes at aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa") and no reply naming Security with Applied or Declined follows it.'.replace("aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", sha("a")) + ` ${REPLY_FORMAT}`,
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

    describe("a reply posted right after the push", () => {
      const product = say(21, `## Product review\n\nVerdict: approve${at("b")}`);
      const commits = [commit("a"), commit("b")];
      const reply = (body: string) => [withChanges[0], withChanges[1], product, say(23, body)];
      const both = "QA: Applied all\nSecurity: Applied all";

      it("counts when it came before CI started, going by the push event", () => {
        const input = { comments: reply(both), commits, lastCodePushedAt: Date.parse(T(25)), codePushedAt: Date.parse(T(22)) };
        expect(evaluate(pull(input)).ok).toBe(true);
      });

      it("counts when it names the pushed commit, even if the push time says it is older", () => {
        const input = { comments: reply(`${both}\nFixed at ${sha("b").slice(0, 9)}`), commits, lastCodePushedAt: Date.parse(T(25)), codePushedAt: Date.parse(T(25)) };
        expect(evaluate(pull(input)).ok).toBe(true);
      });

      it("does not count a reply that names an older commit and is older than the push", () => {
        const input = { comments: reply(`${both}\nSeen at ${sha("a").slice(0, 9)}`), commits, lastCodePushedAt: null, codePushedAt: Date.parse(T(25)) };
        expect(evaluate(pull(input)).reasons).toEqual([
          "The QA verdict is older than the head: code was pushed after the Applied/Declined reply.",
          "The Security verdict is older than the head: code was pushed after the Applied/Declined reply.",
        ]);
      });

      it("ignores a reply from anyone but the trusted reviewer, even when it names the commit", () => {
        const comments = [withChanges[0], withChanges[1], product, say(23, `${both}\nFixed at ${sha("b")}`, "someone-else")];
        expect(evaluate(pull({ comments, commits, lastCodePushedAt: null, codePushedAt: Date.parse(T(25)) })).reasons).toHaveLength(2);
      });

      it("does not count a hex string that matches no commit in the pull request", () => {
        const input = { comments: reply(`${both}\nFixed at ${"9".repeat(12)}`), commits, lastCodePushedAt: null, codePushedAt: Date.parse(T(25)) };
        expect(evaluate(pull(input)).reasons).toHaveLength(2);
      });

      it("uses the check run time only when the push event is unknown", () => {
        expect(evaluate(pull({ comments: reply(both), commits, lastCodePushedAt: Date.parse(T(25)), codePushedAt: null })).ok).toBe(false);
        expect(evaluate(pull({ comments: reply(both), commits, lastCodePushedAt: Date.parse(T(20)), codePushedAt: null })).ok).toBe(true);
      });
    });

    it("needs no time check when the verdict reviewed the latest code", () => {
      const comments = [...withChanges, say(23, "QA: Applied all\nSecurity: Applied all")];
      expect(evaluate(pull({ comments, lastCodePushedAt: null })).ok).toBe(true);
    });
  });

  describe("failing closed on missing data", () => {
    const base = () => ({
      pr: { head: { sha: "a".repeat(40), ref: "wp/x", repo: { full_name: REPO } }, state: "open", base: { ref: "main" }, draft: false, changed_files: 1, commits: 1, labels: [{ name: "perf" }], body: "Semver: patch" },
      files: [{ filename: "src/a.ts" }],
      comments: [{ user: { login: ME, type: "User" }, updated_at: T(1), body: "hello" }],
      commits: [{ sha: sha("a"), parents: [{ sha: "p" }] }],
      checkRuns: [{ id: 1, name: "test", status: "completed", conclusion: "success", app: { slug: "github-actions" } }],
      checkRunsTotal: 1,
      compare: { behind_by: 0 },
    });

    it("accepts complete data", () => {
      expect(buildInput(base(), ME, REPO)).toMatchObject({ labels: ["perf"], behindBy: 0, changedFiles: 1 });
    });

    it.each([
      ["no pull request", (r: Record<string, unknown>) => (r.pr = undefined)],
      ["no head sha", (r: Record<string, unknown>) => (r.pr = { ...base().pr, head: {} })],
      ["a malformed head sha", (r: Record<string, unknown>) => (r.pr = { ...base().pr, head: { sha: "abc" } })],
      ["a draft pull request", (r: Record<string, unknown>) => (r.pr = { ...base().pr, draft: true })],
      ["a pull request from a fork", (r: Record<string, unknown>) => (r.pr = { ...base().pr, head: { sha: "a".repeat(40), ref: "x", repo: { full_name: "someone/fork" } } })],
      ["a pull request with no head repository", (r: Record<string, unknown>) => (r.pr = { ...base().pr, head: { sha: "a".repeat(40), ref: "x" } })],
      ["a commit list that does not end at the head", (r: Record<string, unknown>) => (r.commits = [{ sha: sha("b"), parents: [{ sha: "p" }] }])],
      ["a closed pull request", (r: Record<string, unknown>) => (r.pr = { ...base().pr, state: "closed" })],
      ["another base", (r: Record<string, unknown>) => (r.pr = { ...base().pr, base: { ref: "dev" } })],
      ["no draft flag", (r: Record<string, unknown>) => (r.pr = { ...base().pr, draft: undefined })],
      ["no changed file count", (r: Record<string, unknown>) => (r.pr = { ...base().pr, changed_files: undefined })],
      ["no labels", (r: Record<string, unknown>) => (r.pr = { ...base().pr, labels: undefined })],
      ["files that could not be listed", (r: Record<string, unknown>) => (r.files = undefined)],
      ["a truncated file list", (r: Record<string, unknown>) => (r.pr = { ...base().pr, changed_files: 3000 })],
      ["a file without a name", (r: Record<string, unknown>) => (r.files = [{}])],
      ["a truncated commit list", (r: Record<string, unknown>) => (r.pr = { ...base().pr, commits: 400 })],
      ["comments that could not be read", (r: Record<string, unknown>) => (r.comments = null)],
      ["a comment without an author", (r: Record<string, unknown>) => (r.comments = [{ updated_at: T(1), body: "x" }])],
      ["a comment without an edit time", (r: Record<string, unknown>) => (r.comments = [{ user: { login: ME }, body: "x" }])],
      ["check runs cut short", (r: Record<string, unknown>) => (r.checkRunsTotal = 40)],
      ["check runs that could not be read", (r: Record<string, unknown>) => (r.checkRuns = undefined)],
      ["no compare result", (r: Record<string, unknown>) => (r.compare = undefined)],
      ["a compare result without behind_by", (r: Record<string, unknown>) => (r.compare = {})],
    ])("refuses %s", (_name, damage) => {
      const raw: Record<string, unknown> = base();
      damage(raw);
      expect(() => buildInput(raw, ME, REPO)).toThrow(GateDataError);
    });

    it("refuses when the trusted account is unknown", () => {
      expect(() => buildInput(base(), "", REPO)).toThrow(GateDataError);
      expect(() => buildInput(base(), undefined, REPO)).toThrow(GateDataError);
    });
  });
});
