import { execFileSync } from "node:child_process";
import { buildInput, changesApp, evaluate, GateDataError, lastCodeCommit, semverOf } from "./merge-gate-lib.mjs";

const REPO = "kenneth-yu/trip-planner";
const MARKER = "<!-- merge-gate -->";
const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const sweep = args.includes("--sweep");
const single = args.find((arg) => /^\d+$/.test(arg));
if (!sweep && !single) {
  process.stderr.write("Usage: node tools/merge-gate.mjs <pr number> [--dry-run]\n       node tools/merge-gate.mjs --sweep [--dry-run]\n");
  process.exit(2);
}

function gh(parameters, token) {
  const env = token ? { ...process.env, GH_TOKEN: token } : process.env;
  return execFileSync("gh", parameters, { encoding: "utf8", maxBuffer: 64 * 1024 * 1024, timeout: 120000, env });
}

function gateToken() {
  if (!process.env.GITHUB_ACTIONS) return { ok: true, token: undefined };
  const token = process.env.GATE_TOKEN;
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

function reviewerLogin() {
  return process.env.GATE_OWNER || api("user").login;
}

function gather(number) {
  const pr = api(`repos/${REPO}/pulls/${number}`);
  const head = pr.head.sha;
  const files = apiList(`repos/${REPO}/pulls/${number}/files`, ".[]");
  const comments = apiList(`repos/${REPO}/issues/${number}/comments`, ".[]");
  const commits = apiList(`repos/${REPO}/pulls/${number}/commits`, ".[]").map((c) => ({ sha: c.sha, parents: c.parents }));
  const checkRuns = apiList(`repos/${REPO}/commits/${head}/check-runs`, ".check_runs[]");
  const checkRunsTotal = api(`repos/${REPO}/commits/${head}/check-runs?per_page=1`).total_count;
  const compare = api(`repos/${REPO}/compare/main...${head}`);
  git(["fetch", "-q", "origin", "main", `pull/${number}/head`]);
  const verifiedMerges = new Set();
  for (const commit of commits.filter((c) => c.parents.length === 2)) {
    const status = api(`repos/${REPO}/compare/${commit.parents[1].sha}...main`).status;
    if ((status === "ahead" || status === "identical") && mergeAddsNothing({ sha: commit.sha, parents: commit.parents.map((p) => p.sha) })) verifiedMerges.add(commit.sha);
  }
  const normalized = commits.map((c) => ({ sha: c.sha, parents: c.parents.map((p) => p.sha) }));
  const lastCode = lastCodeCommit(normalized, verifiedMerges);
  const lastCodePushedAt = lastCode ? firstCheckStart(lastCode.sha) : null;
  return { pr, files, comments, commits, checkRuns, checkRunsTotal, compare, verifiedMerges, lastCodePushedAt };
}

function commentAuthor() {
  return process.env.GITHUB_ACTIONS ? "github-actions[bot]" : api("user").login;
}

function upsertComment(number, lines) {
  const body = `${MARKER}\n## Merge gate\n\n${lines.join("\n")}\n`;
  const author = commentAuthor();
  const existing = apiList(`repos/${REPO}/issues/${number}/comments`, ".[] | {id, body, author: .user.login}").find((c) => c.author === author && typeof c.body === "string" && c.body.startsWith(MARKER));
  if (existing && existing.body === body) return;
  if (existing) gh(["api", "-X", "PATCH", `repos/${REPO}/issues/comments/${existing.id}`, "-f", `body=${body}`]);
  else gh(["api", "-X", "POST", `repos/${REPO}/issues/${number}/comments`, "-f", `body=${body}`]);
}

function say(message) {
  process.stdout.write(`${message}\n`);
}

function processPullRequest(number) {
  let raw;
  let input;
  try {
    raw = gather(number);
    input = buildInput(raw, reviewerLogin(), REPO);
  } catch (error) {
    const reason = error instanceof GateDataError ? error.message : `GitHub data could not be read (${error instanceof Error ? error.message.split("\n")[0].slice(0, 120) : "unknown error"}).`;
    say(`#${number}: not merging, ${reason}`);
    if (!dryRun) upsertComment(number, ["Not merging: the gate could not read everything it needs, so it merges nothing.", "", `- ${reason}`]);
    return "blocked";
  }
  const verdict = evaluate(input);
  const branch = raw.pr.head.ref;
  if (!verdict.ok) {
    say(`#${number}: blocked\n${verdict.reasons.map((r) => `  - ${r}`).join("\n")}`);
    if (!dryRun) {
      upsertComment(number, ["Not merging yet. What is missing:", "", ...verdict.reasons.map((r) => `- ${r}`)]);
      if (verdict.needsOwner && !input.labels.includes("needs-owner")) gh(["api", "-X", "POST", `repos/${REPO}/issues/${number}/labels`, "-f", "labels[]=needs-owner"]);
    }
    return "blocked";
  }
  const paths = input.files.flatMap((f) => [f.filename, f.previousFilename].filter((p) => typeof p === "string"));
  const gate = gateToken();
  if (verdict.behind) {
    say(`#${number}: passes, but the branch is behind main`);
    if (dryRun) return "updated";
    if (!gate.ok) return missingToken(number);
    try {
      gh(["api", "-X", "PUT", `repos/${REPO}/pulls/${number}/update-branch`, "-f", `expected_head_sha=${raw.pr.head.sha}`], gate.token);
    } catch (error) {
      return refused(number, "update the branch with main", error);
    }
    upsertComment(number, ["Everything else passes. The branch was behind main, so the gate updated it. The checks run again, and it merges once they pass."]);
    return "updated";
  }
  say(`#${number}: passes at ${raw.pr.head.sha}`);
  if (dryRun) return "merged";
  if (!gate.ok) return missingToken(number);
  const mergeArguments = ["api", "-X", "PUT", `repos/${REPO}/pulls/${number}/merge`, "-f", "merge_method=merge", "-f", `sha=${raw.pr.head.sha}`];
  if (changesApp(paths)) mergeArguments.push("-f", `commit_message=Semver: ${semverOf(input.body).level}`);
  try {
    gh(mergeArguments, gate.token);
  } catch (error) {
    return refused(number, "merge", error);
  }
  try {
    gh(["api", "-X", "DELETE", `repos/${REPO}/git/refs/heads/${branch}`], gate.token);
  } catch (error) {
    say(`#${number}: merged, but the branch could not be deleted (${describe(error)}).`);
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
    say(`#${number}: the comment could not be written either (${describe(commentError)}).`);
  }
  return "failed";
}

function refused(number, action, error) {
  const reason = `GitHub refused to ${action} (${describe(error)}). Someone needs to look at it.`;
  say(`#${number}: ${reason}`);
  try {
    upsertComment(number, ["Everything the gate checks passes, but:", "", `- ${reason}`]);
  } catch (commentError) {
    say(`#${number}: the comment could not be written either (${describe(commentError)}).`);
  }
  return "failed";
}

if (single) {
  const outcome = processPullRequest(single);
  process.exit(outcome === "blocked" || outcome === "failed" ? 1 : 0);
}

let numbers;
try {
  numbers = apiList(`repos/${REPO}/pulls?state=open&per_page=100`, '.[] | select(.draft == false and .head.repo.full_name == "' + REPO + '" and .base.ref == "main") | .number').sort((a, b) => a - b);
} catch (error) {
  process.stderr.write(`The open pull requests could not be listed (${error instanceof Error ? error.message.split("\n")[0].slice(0, 120) : "unknown error"}). Merging nothing.\n`);
  process.exit(1);
}
for (const number of numbers) {
  const outcome = processPullRequest(number);
  if (outcome === "merged" || outcome === "updated") break;
}
process.exit(0);
