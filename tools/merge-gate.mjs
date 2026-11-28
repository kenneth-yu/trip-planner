import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { buildInput, changesApp, evaluate, GateDataError, HOLD_LABELS, isWorkflowRefusal, lastCodeCommit, pushStart, semverOf, WORKFLOW_REASON } from "./merge-gate-lib.mjs";

const REPO = "kenneth-yu/trip-planner";
const MARKER = "<!-- merge-gate -->";
const GATE_SECRET = process.env.GATE_TOKEN;
delete process.env.GATE_TOKEN;
const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const sweep = args.includes("--sweep");
const single = args.find((arg) => /^\d+$/.test(arg));
if (!sweep && !single) {
  process.stderr.write("Usage: node tools/merge-gate.mjs <pr number> [--dry-run]\n       node tools/merge-gate.mjs --sweep [--dry-run]\n");
  process.exit(2);
}

const RESERVE = 150;
let apiCalls = 0;

class RateLimited extends Error {
  constructor(detail) {
    super(`GitHub's API rate limit is used up (${detail}). Nothing was merged and nothing was commented.`);
    this.name = "RateLimited";
  }
}

function gh(parameters, token) {
  const env = token ? { ...process.env, GH_TOKEN: token } : process.env;
  apiCalls += 1;
  try {
    return execFileSync("gh", parameters, { encoding: "utf8", maxBuffer: 64 * 1024 * 1024, timeout: 120000, env });
  } catch (error) {
    const said = error instanceof Error ? [error.message, ...["stdout", "stderr"].map((key) => (key in error && typeof error[key] === "string" ? error[key] : ""))].join("\n") : "";
    if (/rate limit/i.test(said)) throw new RateLimited(describe(error));
    throw error;
  }
}

function budgetLine() {
  try {
    const limits = JSON.parse(gh(["api", "rate_limit"])).resources.core;
    apiCalls -= 1;
    return { remaining: limits.remaining, limit: limits.limit, resetsAt: new Date(limits.reset * 1000).toISOString() };
  } catch (error) {
    if (error instanceof RateLimited) throw error;
    return null;
  }
}

function reportBudget() {
  const budget = budgetLine();
  say(budget ? `Rate budget: ${budget.remaining} of ${budget.limit} calls left, resets at ${budget.resetsAt}. This run made ${apiCalls}.` : `Rate budget: unavailable. This run made ${apiCalls}.`);
}

function gateToken() {
  if (!process.env.GITHUB_ACTIONS) return { ok: true, token: undefined };
  const token = GATE_SECRET;
  return token ? { ok: true, token } : { ok: false, token: undefined };
}

const MISSING_TOKEN = "The GATE_TOKEN secret is not set, so the gate cannot update this branch or merge it. The owner needs to add the GATE_TOKEN repository secret. The gate does not fall back to the workflow token.";

function api(path, extra = []) {
  return JSON.parse(gh(["api", path, ...extra]));
}

function apiList(path, selector) {
  return gh(["api", "--paginate", path, "--jq", selector])
    .split("\n")
    .filter((line) => line.length > 0)
    .map((line) => JSON.parse(line));
}

function git(parameters) {
  return execFileSync("git", parameters, { encoding: "utf8", timeout: 120000 }).trim();
}

function isAncestorOfMain(sha) {
  try {
    git(["merge-base", "--is-ancestor", sha, "origin/main"]);
    return true;
  } catch (error) {
    if (error instanceof Error && "status" in error) return false;
    throw error;
  }
}

const ownDiffs = new Map();

function ownDiff(sha) {
  if (ownDiffs.has(sha)) return ownDiffs.get(sha);
  let digest = null;
  try {
    const base = git(["merge-base", "origin/main", sha]);
    const patch = git(["diff", "-U0", "--no-color", "--no-ext-diff", "--no-renames", base, sha]);
    const kept = patch.split("\n").filter((line) => line.startsWith("diff --git") || line.startsWith("+") || line.startsWith("-"));
    digest = createHash("sha256").update(kept.join("\n")).digest("hex");
  } catch (error) {
    if (!(error instanceof Error && "status" in error)) throw error;
  }
  ownDiffs.set(sha, digest);
  return digest;
}

function mergeAddsNothing(commit) {
  try {
    const fresh = git(["merge-tree", "--write-tree", "--no-messages", commit.parents[0], commit.parents[1]]).split("\n")[0];
    return fresh === git(["rev-parse", `${commit.sha}^{tree}`]);
  } catch (error) {
    if (error instanceof Error && "status" in error) return false;
    throw error;
  }
}

function checkRunPages(sha) {
  const pages = apiList(`repos/${REPO}/commits/${sha}/check-runs?per_page=100`, "{total: .total_count, runs: .check_runs}");
  return { total: pages.length > 0 ? pages[0].total : null, runs: pages.flatMap((page) => (Array.isArray(page.runs) ? page.runs : [])) };
}

let whoAmI = null;

function me() {
  whoAmI ??= api("user").login;
  return whoAmI;
}

function reviewerLogin() {
  return process.env.GATE_OWNER || me();
}

function gather(number) {
  const pr = api(`repos/${REPO}/pulls/${number}`);
  const head = pr.head.sha;
  const files = apiList(`repos/${REPO}/pulls/${number}/files?per_page=100`, ".[]");
  const comments = apiList(`repos/${REPO}/issues/${number}/comments?per_page=100`, ".[]");
  seenComments.set(number, comments);
  const commits = apiList(`repos/${REPO}/pulls/${number}/commits?per_page=100`, ".[]").map((c) => ({ sha: c.sha, parents: c.parents }));
  const { total: checkRunsTotal, runs: checkRuns } = checkRunPages(head);
  const compare = api(`repos/${REPO}/compare/main...${head}`);
  git(["fetch", "-q", "origin", "main", `pull/${number}/head`]);
  const verifiedMerges = new Set();
  const conflictMerges = new Set();
  for (const commit of commits.filter((c) => c.parents.length === 2)) {
    if (!isAncestorOfMain(commit.parents[1].sha)) continue;
    const parents = commit.parents.map((p) => p.sha);
    const unchanged = ownDiff(commit.sha) !== null && ownDiff(commit.sha) === ownDiff(parents[0]);
    if (unchanged || mergeAddsNothing({ sha: commit.sha, parents })) verifiedMerges.add(commit.sha);
    else conflictMerges.add(commit.sha);
  }
  const normalized = commits.map((c) => ({ sha: c.sha, parents: c.parents.map((p) => p.sha) }));
  const lastCode = lastCodeCommit(normalized, verifiedMerges);
  const lastCodePushedAt = lastCode ? pushStart(normalized, lastCode.sha, (sha) => (sha === head ? checkRuns : checkRunPages(sha).runs)) : null;
  return { pr, files, comments, commits, checkRuns, checkRunsTotal, compare, verifiedMerges, conflictMerges, lastCodePushedAt };
}

function commentAuthor() {
  return process.env.GITHUB_ACTIONS ? "github-actions[bot]" : me();
}

const seenComments = new Map();

function upsertComment(number, lines) {
  const body = `${MARKER}\n## Merge gate\n\n${lines.join("\n")}\n`;
  const author = commentAuthor();
  const known = seenComments.get(number) ?? apiList(`repos/${REPO}/issues/${number}/comments?per_page=100`, ".[]");
  seenComments.delete(number);
  const existing = known.map((c) => ({ id: c.id, body: c.body, author: c.user?.login })).find((c) => c.author === author && typeof c.body === "string" && c.body.startsWith(MARKER));
  if (existing && existing.body === body) return;
  if (existing) gh(["api", "-X", "PATCH", `repos/${REPO}/issues/comments/${existing.id}`, "-f", `body=${body}`]);
  else gh(["api", "-X", "POST", `repos/${REPO}/issues/${number}/comments`, "-f", `body=${body}`]);
}

function say(message) {
  process.stdout.write(`${message}\n`);
}

function processPullRequest(number, defer = false) {
  const callsBefore = apiCalls;
  const outcome = evaluateAndAct(number, defer);
  say(`#${number}: ${apiCalls - callsBefore} API calls`);
  return outcome;
}

function checksRunning(checkRuns) {
  return checkRuns.some((run) => run.appSlug === "github-actions" && run.status !== "completed");
}

function evaluateAndAct(number, defer) {
  let raw;
  let input;
  try {
    raw = gather(number);
    input = buildInput(raw, reviewerLogin(), REPO);
  } catch (error) {
    if (error instanceof RateLimited) throw error;
    const reason = error instanceof GateDataError ? error.message : `GitHub data could not be read (${error instanceof Error ? error.message.split("\n")[0].slice(0, 120) : "unknown error"}).`;
    say(`#${number}: not merging, ${reason}`);
    if (!dryRun) upsertComment(number, ["Not merging: the gate could not read everything it needs, so it merges nothing.", "", `- ${reason}`]);
    return "blocked";
  }
  const verdict = evaluate(input);
  const branch = raw.pr.head.ref;
  const updatable = verdict.behind && verdict.approved;
  if (!verdict.ok && !updatable) {
    say(`#${number}: blocked\n${verdict.reasons.map((r) => `  - ${r}`).join("\n")}`);
    if (!dryRun) {
      upsertComment(number, ["Not merging yet. What is missing:", "", ...verdict.reasons.map((r) => `- ${r}`)]);
      if (verdict.needsOwner && !input.labels.includes("needs-owner")) gh(["api", "-X", "POST", `repos/${REPO}/issues/${number}/labels`, "-f", "labels[]=needs-owner"]);
    }
    return "blocked";
  }
  const gate = gateToken();
  if (verdict.behind) {
    if (checksRunning(input.checkRuns)) {
      say(`#${number}: behind main, but its checks are running, so it is not updated again`);
      return "waiting";
    }
    say(verdict.ok ? `#${number}: passes, but the branch is behind main` : `#${number}: approved, but the branch is behind main and its checks have not passed, so it is updated to run them again`);
    if (dryRun) return "updated";
    const update = () => {
      if (!gate.ok) return missingToken(number);
      try {
        gh(["api", "-X", "PUT", `repos/${REPO}/pulls/${number}/update-branch`, "-f", `expected_head_sha=${raw.pr.head.sha}`], gate.token);
      } catch (error) {
        return refused(number, "update the branch with main", error, input.labels);
      }
      upsertComment(number, ["The reviews pass. The branch was behind main, so the gate updated it. The checks run again, and it merges once they pass."]);
      say(`#${number}: updated`);
      return "updated";
    };
    return defer ? { status: "behind", number, run: update } : update();
  }
  say(`#${number}: passes at ${raw.pr.head.sha}`);
  if (dryRun) return "merged";
  const merge = () => mergeNow(number, raw, input, gate, branch);
  return defer ? { status: "ready", number, run: merge } : merge();
}

function mergeNow(number, raw, input, gate, branch) {
  const paths = input.files.flatMap((f) => [f.filename, f.previousFilename].filter((p) => typeof p === "string"));
  if (!gate.ok) return missingToken(number);
  const mergeArguments = ["api", "-X", "PUT", `repos/${REPO}/pulls/${number}/merge`, "-f", "merge_method=merge", "-f", `sha=${raw.pr.head.sha}`];
  if (changesApp(paths)) mergeArguments.push("-f", `commit_message=Semver: ${semverOf(input.body).level}`);
  try {
    gh(mergeArguments, gate.token);
  } catch (error) {
    return refused(number, "merge", error, input.labels);
  }
  const keep = branchToKeep(branch, raw.pr.base.ref);
  if (keep) say(`#${number}: merged, and the branch was not deleted because ${keep}.`);
  else {
    try {
      gh(["api", "-X", "DELETE", `repos/${REPO}/git/refs/heads/${branch.split("/").map(encodeURIComponent).join("/")}`], gate.token);
    } catch (error) {
      if (error instanceof RateLimited) throw error;
      say(`#${number}: merged, but the branch could not be deleted (${describe(error)}).`);
    }
  }
  say(`#${number}: merged`);
  return "merged";
}

function reasonFrom(text) {
  try {
    const parsed = JSON.parse(text);
    return parsed && typeof parsed === "object" && "message" in parsed && typeof parsed.message === "string" ? parsed.message : null;
  } catch (error) {
    if (error instanceof SyntaxError) return null;
    throw error;
  }
}

function describe(error) {
  if (!(error instanceof Error)) return "unknown error";
  const said = ["stdout", "stderr"].map((key) => (key in error && typeof error[key] === "string" ? error[key].trim() : ""));
  const reason = reasonFrom(said[0]) ?? said[1].split("\n")[0];
  return (reason || error.message.split("\n")[0]).replace(/[^\x20-\x7e]/g, "").slice(0, 200);
}

function missingToken(number) {
  say(`#${number}: ${MISSING_TOKEN}`);
  try {
    upsertComment(number, ["Everything the gate checks passes, but:", "", `- ${MISSING_TOKEN}`]);
  } catch (commentError) {
    if (commentError instanceof RateLimited) throw commentError;
    say(`#${number}: the comment could not be written either (${describe(commentError)}).`);
  }
  return "missing-token";
}

const SAFE_BRANCH = /^[A-Za-z0-9._/-]+$/;

function branchToKeep(branch, base) {
  if (typeof branch !== "string" || !SAFE_BRANCH.test(branch)) return "its name has characters the gate never deletes";
  if (branch.split("/").some((segment) => segment === "" || segment === "." || segment === "..")) return "its name has an empty or dot segment";
  if (branch === base || branch === "main") return "it is the base branch";
  return null;
}

function codeSpan(text) {
  return `\`${text.replace(/[`\s]+/g, " ").trim()}\``;
}

function refusalText(error) {
  if (!(error instanceof Error)) return "";
  const said = ["stdout", "stderr"].map((key) => (key in error && typeof error[key] === "string" ? error[key] : ""));
  return `${error.message}\n${said.join("\n")}`;
}

function refused(number, action, error, labels = []) {
  if (error instanceof RateLimited) throw error;
  if (isWorkflowRefusal(refusalText(error))) {
    say(`#${number}: ${WORKFLOW_REASON}`);
    try {
      upsertComment(number, ["Everything the gate checks passes, but:", "", `- ${WORKFLOW_REASON}`]);
    } catch (commentError) {
      if (commentError instanceof RateLimited) throw commentError;
      say(`#${number}: the comment could not be written (${describe(commentError)}).`);
    }
    if (!labels.includes("needs-owner")) {
      try {
        gh(["api", "-X", "POST", `repos/${REPO}/issues/${number}/labels`, "-f", "labels[]=needs-owner"]);
      } catch (labelError) {
        if (labelError instanceof RateLimited) throw labelError;
        say(`#${number}: the needs-owner label could not be applied (${describe(labelError)}).`);
      }
    }
    return "blocked";
  }
  const reason = `GitHub refused to ${action}: ${codeSpan(describe(error))}. Someone needs to look at it.`;
  say(`#${number}: ${reason}`);
  try {
    upsertComment(number, ["Everything the gate checks passes, but:", "", `- ${reason}`]);
  } catch (commentError) {
    if (commentError instanceof RateLimited) throw commentError;
    say(`#${number}: the comment could not be written either (${describe(commentError)}).`);
  }
  return "failed";
}

function finish(code) {
  try {
    reportBudget();
  } catch (error) {
    say(error instanceof Error ? error.message : "Rate budget: unavailable.");
  }
  process.exit(code);
}

function main() {
  if (single) {
    const outcome = processPullRequest(single);
    return outcome === "blocked" || outcome === "failed" || outcome === "missing-token" ? 1 : 0;
  }
  let open;
  try {
    open = apiList(`repos/${REPO}/pulls?state=open&per_page=100`, '.[] | select(.draft == false and .head.repo.full_name == "' + REPO + '" and .base.ref == "main") | {number, labels: [.labels[].name]}').sort((a, b) => a.number - b.number);
  } catch (error) {
    if (error instanceof RateLimited) throw error;
    process.stderr.write(`The open pull requests could not be listed (${error instanceof Error ? error.message.split("\n")[0].slice(0, 120) : "unknown error"}). Merging nothing.\n`);
    return 1;
  }
  const budget = budgetLine();
  if (budget && budget.remaining < RESERVE) {
    process.stdout.write(`::warning::Merge gate skipped: ${budget.remaining} API calls left, below the ${RESERVE} it needs. It resets at ${budget.resetsAt}.\n`);
    return 0;
  }
  const pending = [];
  for (const { number, labels } of open) {
    const held = HOLD_LABELS.filter((label) => labels.includes(label));
    if (held.length > 0) {
      say(`#${number}: skipped, it carries the ${held.join(" and ")} label`);
      continue;
    }
    const outcome = processPullRequest(number, true);
    if (typeof outcome === "object") pending.push(outcome);
    else if (outcome === "missing-token") return 1;
  }
  const act = (item) => {
    const callsBefore = apiCalls;
    const outcome = item.run();
    say(`#${item.number}: ${apiCalls - callsBefore} API calls to ${item.status === "ready" ? "merge" : "update"}`);
    return outcome;
  };
  for (const ready of pending.filter((item) => item.status === "ready")) {
    const outcome = act(ready);
    if (outcome === "missing-token") return 1;
    if (outcome === "merged") break;
  }
  for (const behind of pending.filter((item) => item.status === "behind")) {
    if (act(behind) === "missing-token") return 1;
  }
  return 0;
}

let exitCode;
try {
  exitCode = main();
} catch (error) {
  if (!(error instanceof RateLimited)) throw error;
  process.stderr.write(`${error.message}\n`);
  exitCode = 1;
}
finish(exitCode);
