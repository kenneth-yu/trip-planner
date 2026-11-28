import path from "node:path";
import { describe, expect, it } from "vitest";
import { makeHarness, type Route } from "./fake-gh";

const REPO = "kenneth-yu/trip-planner";
const tool = path.join(process.cwd(), "tools", "merge-gate.mjs");
const lines = (items: unknown[]) => items.map((item) => JSON.stringify(item)).join("\n") + (items.length > 0 ? "\n" : "");
const headOf = (number: number) => String(number).repeat(40).slice(0, 40).replace(/./g, (_c, i) => "abcdef"[(i + number) % 6]);
const REQUIRED = ["static", "test", "postgres", "prod-build", "gitleaks"];

interface Options {
  number: number;
  files?: string[];
  body?: string;
  behindBy?: number | null;
  checkRunsTotal?: number;
  comments?: unknown[];
  mergeFails?: boolean;
  mergeFailMessage?: string;
  headRef?: string;
  deleteFails?: boolean;
}

function routesFor(options: Options): Route[] {
  const { number } = options;
  const head = headOf(number);
  const files = options.files ?? ["docs/UX.md"];
  const checks = REQUIRED.map((name, index) => ({ id: index + 1, name, status: "completed", conclusion: "success", app: { slug: "github-actions" } }));
  const base = `repos/${REPO}`;
  const pr = {
    state: "open",
    base: { ref: "main" },
    head: { sha: head, ref: options.headRef ?? `wp/${number}`, repo: { full_name: REPO } },
    draft: false,
    changed_files: files.length,
    commits: 1,
    labels: [],
    body: options.body ?? "",
    merge_commit_sha: "c".repeat(40),
  };
  return [
    { match: `-X POST ${base}/issues/${number}/comments`, out: "{}" },
    { match: `-X PATCH ${base}/issues/comments`, out: "{}" },
    { match: `-X PUT ${base}/pulls/${number}/update-branch`, out: "{}" },
    { match: `-X POST ${base}/issues/${number}/labels`, out: "[]" },
    { match: `-X PUT ${base}/pulls/${number}/merge`, ...(options.mergeFails ? { fail: "gh: refused (HTTP 405)", failBody: JSON.stringify({ message: options.mergeFailMessage ?? 'Required status check "test" is expected.', status: "405" }) } : { out: "{}" }) },
    { match: `-X DELETE ${base}/git/refs/heads/`, ...(options.deleteFails ? { fail: "gh: Reference does not exist (HTTP 422)" } : { out: "" }) },
    { match: "workflow run", out: "" },
    { match: `${base}/commits/${head}/check-runs?per_page=1`, out: JSON.stringify({ total_count: options.checkRunsTotal ?? checks.length }) },
    { match: `${base}/commits/${head}/check-runs --jq .check_runs[] | {t:`, out: lines([{ t: "2026-11-27T10:00:00Z" }]) },
    { match: `${base}/commits/${head}/check-runs --jq`, out: lines(checks) },
    { match: `${base}/compare/main...${head}`, out: JSON.stringify(options.behindBy === null ? {} : { behind_by: options.behindBy ?? 0, status: "ahead" }) },
    { match: `${base}/pulls/${number}/files`, out: lines(files.map((filename) => ({ filename }))) },
    { match: `${base}/issues/${number}/comments --jq .[] | {id, body, author`, out: "" },
    { match: `${base}/issues/${number}/comments`, out: lines(options.comments ?? []) },
    { match: `${base}/pulls/${number}/commits`, out: lines([{ sha: head, parents: [{ sha: "d".repeat(40) }] }]) },
    { match: `${base}/pulls/${number} `, out: JSON.stringify(pr) },
    { match: `${base}/pulls/${number}`, out: JSON.stringify(pr) },
  ];
}

function sweep(numbers: number[], perPull: Options[], listing = numbers) {
  const harness = makeHarness({ pullRefs: numbers });
  harness.setRoutes([{ match: "pulls?state=open", out: listing.map((n) => `${n}\n`).join("") }, ...perPull.flatMap(routesFor)]);
  const result = harness.run(process.execPath, [tool, "--sweep"], { GATE_OWNER: "kenneth-yu", GITHUB_ACTIONS: "true" });
  return { result, calls: harness.calls() };
}

const verdict = (word: string, name: string, head: string) => ({ user: { login: "kenneth-yu", type: "User" }, updated_at: "2026-11-27T10:05:00Z", body: `## ${name} review\n\nVerdict: ${word} at ${head}` });

describe("merge-gate.mjs against a fake GitHub", () => {
  it("merges a passing pull request with its head sha pinned, then starts the release and main workflows", () => {
    const { result, calls } = sweep([7], [{ number: 7 }]);
    expect(result.status).toBe(0);
    expect(calls.find((c) => c.includes("/pulls/7/merge"))).toBe(`api -X PUT repos/${REPO}/pulls/7/merge -f merge_method=merge -f sha=${headOf(7)}`);
    expect(calls).toContain(`api -X DELETE repos/${REPO}/git/refs/heads/wp/7`);
    expect(calls).toContain(`workflow run release.yml --repo ${REPO} --ref main -f sha=${"c".repeat(40)}`);
    expect(calls).toContain(`workflow run ci.yml --repo ${REPO} --ref main`);
    expect(calls).toContain(`workflow run perf.yml --repo ${REPO} --ref main`);
  });

  it("writes the validated Semver level into the merge commit for a pull request that changes the app", () => {
    const head = headOf(7);
    const comments = [verdict("approve", "QA", head), verdict("clear", "Security", head), verdict("approve", "Product", head)];
    const { calls } = sweep([7], [{ number: 7, files: ["src/server/services/a.ts"], body: "Notes\n\nSemver: minor\n", comments }]);
    expect(calls.find((c) => c.includes("/pulls/7/merge"))).toBe(`api -X PUT repos/${REPO}/pulls/7/merge -f merge_method=merge -f sha=${head} -f commit_message=Semver: minor`);
  });

  it("does not merge, and says why, when a pull request that changes the app has no Semver line", () => {
    const head = headOf(7);
    const comments = [verdict("approve", "QA", head), verdict("clear", "Security", head), verdict("approve", "Product", head)];
    const { calls } = sweep([7], [{ number: 7, files: ["src/server/services/a.ts"], body: "no version", comments }]);
    expect(calls.some((c) => c.includes("/merge -f merge_method"))).toBe(false);
    expect(calls.some((c) => c.includes(`-X POST repos/${REPO}/issues/7/comments`) && c.includes("Semver"))).toBe(true);
  });

  it("updates a passing branch that is behind main, starts its checks, and merges nothing", () => {
    const { result, calls } = sweep([7], [{ number: 7, behindBy: 2 }]);
    expect(result.status).toBe(0);
    expect(calls).toContain(`api -X PUT repos/${REPO}/pulls/7/update-branch -f expected_head_sha=${headOf(7)}`);
    expect(calls).toContain(`workflow run ci.yml --repo ${REPO} --ref wp/7`);
    expect(calls).toContain(`workflow run security.yml --repo ${REPO} --ref wp/7`);
    expect(calls.some((c) => c.includes("/merge -f merge_method"))).toBe(false);
  });

  describe("deleting the branch after a merge", () => {
    const deletes = (calls: string[]) => calls.filter((c) => c.includes("-X DELETE"));

    it("deletes an ordinary branch with each segment encoded", () => {
      const { calls } = sweep([7], [{ number: 7, headRef: "wp/20-google.import_x" }]);
      expect(deletes(calls)).toEqual([`api -X DELETE repos/${REPO}/git/refs/heads/wp/20-google.import_x`]);
    });

    it.each(["main#x", "wp/9#x", "wp/7%2F..", "wp/../main", "wp//x", "wp/x?y", "wp/x y", "wp/\u00e9"])("never deletes anything for the branch name %s", (headRef) => {
      const { calls, result } = sweep([7], [{ number: 7, headRef }]);
      expect(deletes(calls)).toEqual([]);
      expect(calls.some((c) => c.includes("/pulls/7/merge"))).toBe(true);
      expect(result.stdout).toContain("the branch was not deleted because");
    });

    it("never deletes main", () => {
      const { calls, result } = sweep([7], [{ number: 7, headRef: "main" }]);
      expect(deletes(calls)).toEqual([]);
      expect(result.stdout).toContain("it is the base branch");
    });

    it("still records the merge and starts the release when the delete fails", () => {
      const { calls, result } = sweep([7], [{ number: 7, deleteFails: true }]);
      expect(deletes(calls)).toHaveLength(1);
      expect(result.stdout).toContain("#7: merged, but the branch could not be deleted");
      expect(result.stdout).toContain("#7: merged\n");
      expect(calls).toContain(`workflow run release.yml --repo ${REPO} --ref main -f sha=${"c".repeat(40)}`);
      expect(calls.some((c) => c.includes("issues/7/comments") && c.includes("refused"))).toBe(false);
    });
  });

  it("reports a head sha that changed under it (409) without a retry, and goes on", () => {
    const { calls } = sweep([7, 8], [{ number: 7, mergeFails: true, mergeFailMessage: "Head branch was modified. Review and try the merge again." }, { number: 8 }]);
    expect(calls.filter((c) => c.includes("/pulls/7/merge"))).toHaveLength(1);
    expect(calls.some((c) => c.includes("issues/7/comments") && c.includes("`Head branch was modified. Review and try the merge again.`"))).toBe(true);
    expect(calls.some((c) => c.includes("/pulls/8/merge"))).toBe(true);
  });

  it("puts GitHub's refusal text in a code span with backticks and line breaks removed, so links and mentions cannot render", () => {
    const evil = "[click](https://evil.example) @someone `x`\nline two";
    const { calls } = sweep([7], [{ number: 7, mergeFails: true, mergeFailMessage: evil }]);
    const comment = calls.find((c) => c.includes("issues/7/comments") && c.includes("refused to merge")) ?? "";
    expect(comment).toContain("`[click](https://evil.example) @someone x line two`");
    expect(comment).not.toMatch(/``/);
  });

  it("goes on to the next pull request when a merge is refused, and comments on the one that failed", () => {
    const { calls } = sweep([7, 8], [{ number: 7, mergeFails: true }, { number: 8 }]);
    expect(calls.some((c) => c.includes("/pulls/7/merge"))).toBe(true);
    expect(calls.some((c) => c.includes(`-X POST repos/${REPO}/issues/7/comments`) && c.includes("refused to merge: `Required status check \"test\" is expected.`"))).toBe(true);
    expect(calls.some((c) => c.includes("/pulls/8/merge"))).toBe(true);
  });

  it("goes on to the next pull request when update-branch is refused", () => {
    const failing = routesFor({ number: 7, behindBy: 1 }).map((route) => (route.match.includes("update-branch") ? { match: route.match, fail: "422 Unprocessable" } : route));
    const harness = makeHarness({ pullRefs: [7, 8] });
    harness.setRoutes([{ match: "pulls?state=open", out: "7\n8\n" }, ...failing, ...routesFor({ number: 8 })]);
    harness.run(process.execPath, [tool, "--sweep"], { GATE_OWNER: "kenneth-yu", GITHUB_ACTIONS: "true" });
    const calls = harness.calls();
    expect(calls.some((c) => c.includes("issues/7/comments") && c.includes("update the branch"))).toBe(true);
    expect(calls.some((c) => c.includes("/pulls/8/merge"))).toBe(true);
  });

  it.each([
    ["the check runs are cut short", { checkRunsTotal: 40 }],
    ["the compare result has no behind_by", { behindBy: null }],
  ])("merges nothing when %s, and says so in its comment", (_name, damage) => {
    const { calls } = sweep([7], [{ number: 7, ...damage }]);
    expect(calls.some((c) => c.includes("/merge -f merge_method") || c.includes("update-branch"))).toBe(false);
    expect(calls.some((c) => c.includes(`-X POST repos/${REPO}/issues/7/comments`) && c.includes("could not read everything"))).toBe(true);
  });

  it("merges nothing when the open pull requests cannot be listed", () => {
    const harness = makeHarness();
    harness.setRoutes([{ match: "pulls?state=open", fail: "HTTP 502" }]);
    const result = harness.run(process.execPath, [tool, "--sweep"], { GATE_OWNER: "kenneth-yu", GITHUB_ACTIONS: "true" });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("could not be listed");
    expect(harness.calls().some((c) => c.includes("/merge -f merge_method"))).toBe(false);
  });

  it("finds its own comment by author and marker, and edits it in place", () => {
    const harness = makeHarness({ pullRefs: [7] });
    const routes = routesFor({ number: 7, checkRunsTotal: 40 }).map((route) =>
      route.match.includes("{id, body, author")
        ? {
            match: route.match,
            out: lines([
              { id: 11, body: "<!-- merge-gate -->\nforged by someone", author: "someone-else" },
              { id: 12, body: "<!-- merge-gate -->\nold text", author: "github-actions[bot]" },
            ]),
          }
        : route,
    );
    harness.setRoutes([{ match: "pulls?state=open", out: "7\n" }, ...routes]);
    harness.run(process.execPath, [tool, "--sweep"], { GATE_OWNER: "kenneth-yu", GITHUB_ACTIONS: "true" });
    const calls = harness.calls();
    expect(calls.some((c) => c.startsWith(`api -X PATCH repos/${REPO}/issues/comments/12`))).toBe(true);
    expect(calls.some((c) => c.includes("issues/comments/11"))).toBe(false);
  });
});
