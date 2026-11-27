import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { countRuns, failingTestNames, reviewOf, runsForPullRequest } from "./pipeline-metrics-lib.mjs";

const out = process.argv[2];
if (!out) {
  process.stderr.write("Usage: node tools/pipeline-metrics.mjs <output.json>   (write under .pipeline/, which git ignores)\n");
  process.exit(2);
}

const PR_LIMIT = 500;
const RUN_LIMIT = 1000;

function describe(error) {
  if (!(error instanceof Error)) return "unknown error";
  const stderr = "stderr" in error && typeof error.stderr === "string" ? error.stderr.trim() : "";
  return stderr || error.message;
}

function gh(args) {
  return execFileSync("gh", args, { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
}

function list(args, limit, what) {
  const items = JSON.parse(gh([...args, "--limit", String(limit)]));
  if (items.length >= limit) process.stderr.write(`warning: ${what} stopped at the limit of ${limit}; older ones are missing\n`);
  return items;
}

const prs = list(["pr", "list", "--state", "all", "--json", "number,title,state,createdAt,mergedAt,headRefName,comments"], PR_LIMIT, "pull request list");
const runs = list(["run", "list", "--json", "databaseId,headBranch,headSha,conclusion,createdAt,workflowName,event,status"], RUN_LIMIT, "workflow run list");

function commitShas(number) {
  return gh(["api", "--paginate", `repos/kenneth-yu/trip-planner/pulls/${number}/commits`, "--jq", ".[].sha"])
    .split("\n")
    .filter((line) => /^[0-9a-f]{40}$/.test(line));
}

function failingTests(runId) {
  try {
    return failingTestNames(gh(["run", "view", String(runId), "--log-failed"]));
  } catch (error) {
    process.stderr.write(`log unavailable for run ${runId}: ${describe(error)}\n`);
    return null;
  }
}

function hoursBetween(a, b) {
  return Math.round(((Date.parse(b) - Date.parse(a)) / 36e5) * 10) / 10;
}

function kindOf(title) {
  if (/^throwaway/i.test(title)) return "throwaway";
  if (/^revert/i.test(title)) return "revert";
  if (/^WP-|^wp-/i.test(title)) return "package";
  if (/docs|UX\.md|roles/i.test(title)) return "docs";
  return "fix";
}

const rows = prs
  .filter((pr) => kindOf(pr.title) !== "throwaway")
  .map((pr) => {
    const reviews = pr.comments.map((c) => reviewOf(c.body)).filter((r) => r !== null);
    const blocking = reviews.filter((r) => r.outcome === "blocking");
    const changes = reviews.filter((r) => r.outcome === "changes");
    const mine = runsForPullRequest(runs, commitShas(pr.number)).filter((r) => r.status === "completed");
    const ci = mine.filter((r) => r.workflowName === "ci" && r.event === "pull_request").sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt));
    const e2e = mine.filter((r) => r.workflowName === "e2e");
    const ciCounts = countRuns(ci);
    const e2eCounts = countRuns(e2e);
    return {
      pr: pr.number,
      title: pr.title,
      kind: kindOf(pr.title),
      state: pr.state,
      opened: pr.createdAt,
      merged: pr.mergedAt ?? null,
      hours_to_merge: pr.mergedAt ? hoursBetween(pr.createdAt, pr.mergedAt) : null,
      hours_open: pr.mergedAt ? null : hoursBetween(pr.createdAt, new Date().toISOString()),
      reviews: reviews.length,
      blocking_send_backs: blocking.length,
      approve_with_changes: changes.length,
      ux_blocking: blocking.filter((r) => r.reviewer === "ux").length,
      security_blocking: blocking.filter((r) => r.reviewer === "security").length,
      qa_blocking: blocking.filter((r) => r.reviewer === "qa").length,
      product_blocking: blocking.filter((r) => r.reviewer === "product").length,
      ux_with_changes: changes.filter((r) => r.reviewer === "ux").length,
      security_with_changes: changes.filter((r) => r.reviewer === "security").length,
      qa_with_changes: changes.filter((r) => r.reviewer === "qa").length,
      product_with_changes: changes.filter((r) => r.reviewer === "product").length,
      first_ci: ci[0]?.conclusion ?? null,
      ci_runs: ciCounts.total,
      ci_failures: ciCounts.failures,
      ci_cancelled: ciCounts.cancelled,
      e2e_runs: e2eCounts.total,
      e2e_failures: e2eCounts.failures,
      e2e_cancelled: e2eCounts.cancelled,
      e2e_failing_tests: mine
        .filter((r) => r.conclusion === "failure" && (r.workflowName === "e2e" || r.workflowName === "ci"))
        .map((r) => ({ run: r.databaseId, workflow: r.workflowName, tests: failingTests(r.databaseId) }))
        .filter((entry) => entry.workflow === "e2e" || entry.tests !== null),
    };
  })
  .sort((a, b) => a.pr - b.pr);

writeFileSync(out, JSON.stringify(rows), { mode: 0o600 });
process.stdout.write(`${rows.length} pull requests\n`);
