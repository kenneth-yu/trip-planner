import { execFileSync } from "node:child_process";
import { evaluate, lastCodeCommit } from "./merge-gate-lib.mjs";

const REPO = "kenneth-yu/trip-planner";
const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const number = args.find((arg) => /^\d+$/.test(arg));
if (!number) {
  process.stderr.write("Usage: node tools/merge-gate.mjs <pr number> [--dry-run]\n");
  process.exit(2);
}

function gh(parameters) {
  return execFileSync("gh", parameters, { encoding: "utf8", maxBuffer: 64 * 1024 * 1024, timeout: 120000 });
}

function api(path) {
  return JSON.parse(gh(["api", path]));
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

function mergeAddsNothing(commit) {
  try {
    const fresh = git(["merge-tree", "--write-tree", "--no-messages", commit.parents[0], commit.parents[1]]).split("\n")[0];
    return fresh === git(["rev-parse", `${commit.sha}^{tree}`]);
  } catch (error) {
    if (error instanceof Error && "status" in error) return false;
    throw error;
  }
}

function firstCheckStart(sha) {
  const starts = apiList(`repos/${REPO}/commits/${sha}/check-runs`, ".check_runs[] | {t: .started_at}").map((value) => Date.parse(value.t)).filter((value) => Number.isFinite(value));
  return starts.length > 0 ? Math.min(...starts) : null;
}

function refuse(message) {
  process.stderr.write(`Not merging pull request ${number}:\n${message}\n`);
  process.exit(1);
}

function gather() {
  const pr = api(`repos/${REPO}/pulls/${number}`);
  if (pr.state !== "open") refuse(`- The pull request is ${pr.state}, not open.`);
  if (pr.base.ref !== "main") refuse(`- The pull request targets ${pr.base.ref}, not main.`);
  const head = pr.head.sha;
  if (!/^[0-9a-f]{40}$/.test(head)) refuse("- The head commit id is not a full commit id.");
  const reviewerLogin = api("user").login;
  const files = apiList(`repos/${REPO}/pulls/${number}/files`, ".[]").map((f) => ({ filename: f.filename, previousFilename: f.previous_filename }));
  const comments = apiList(`repos/${REPO}/issues/${number}/comments`, ".[]").map((c) => ({
    author: c.user.login,
    authorType: c.user.type,
    body: c.body,
    updatedAt: c.updated_at,
  }));
  const commits = apiList(`repos/${REPO}/pulls/${number}/commits`, ".[]").map((c) => ({
    sha: c.sha,
    parents: c.parents.map((p) => p.sha),
  }));
  const checkRuns = apiList(`repos/${REPO}/commits/${head}/check-runs`, ".check_runs[]").map((r) => ({
    id: r.id,
    name: r.name,
    status: r.status,
    conclusion: r.conclusion,
    appSlug: r.app ? r.app.slug : "",
  }));
  const behindBy = api(`repos/${REPO}/compare/main...${head}`).behind_by;
  git(["fetch", "-q", "origin", "main", `pull/${number}/head`]);
  const verifiedMerges = new Set();
  for (const commit of commits.filter((c) => c.parents.length === 2)) {
    const status = api(`repos/${REPO}/compare/${commit.parents[1]}...main`).status;
    if ((status === "ahead" || status === "identical") && mergeAddsNothing(commit)) verifiedMerges.add(commit.sha);
  }
  const lastCode = lastCodeCommit(commits, verifiedMerges);
  const lastCodePushedAt = lastCode ? firstCheckStart(lastCode.sha) : null;
  return { head, input: { reviewerLogin, files, changedFiles: pr.changed_files, comments, commits, checkRuns, behindBy, verifiedMerges, lastCodePushedAt } };
}

let gathered;
try {
  gathered = gather();
} catch (error) {
  refuse(`- Could not read the pull request from GitHub (${error instanceof Error ? error.message.split("\n")[0].slice(0, 120) : "unknown error"}).`);
}

const verdict = evaluate(gathered.input);
if (!verdict.ok) refuse(verdict.reasons.map((reason) => `- ${reason}`).join("\n"));

if (dryRun) {
  process.stdout.write(`Pull request ${number} passes the merge gate at ${gathered.head}. Dry run, not merging.\n`);
  process.exit(0);
}

try {
  gh(["pr", "merge", number, "--repo", REPO, "--merge", "--delete-branch", "--match-head-commit", gathered.head]);
} catch (error) {
  refuse(`- GitHub refused the merge (${error instanceof Error ? error.message.split("\n")[0].slice(0, 120) : "unknown error"}).`);
}
process.stdout.write(`Merged pull request ${number} at ${gathered.head}.\n`);
