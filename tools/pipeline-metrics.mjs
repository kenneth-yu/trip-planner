import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";

const out = process.argv[2];
if (!out) {
  process.stderr.write("Usage: node tools/pipeline-metrics.mjs <output.json>\n");
  process.exit(2);
}

function gh(args) {
  return JSON.parse(execFileSync("gh", args, { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 }));
}

const prs = gh(["pr", "list", "--state", "all", "--limit", "500", "--json", "number,title,state,createdAt,mergedAt,headRefName,comments"]);
const runs = gh(["run", "list", "--limit", "1000", "--json", "databaseId,headBranch,headSha,conclusion,createdAt,workflowName,event,status"]);

const REVIEWERS = [
  ["ux", /ux review/i],
  ["security", /security/i],
  ["qa", /\bqa\b/i],
  ["product", /product review/i],
];
const BLOCKING = /(send back|not ready|blocked|rethink)/i;
const CONDITIONAL = /(ready with fixes|clear with fixes|ship with changes|approve with changes|with changes|with fixes)/i;
const OK = /(approve|ready|clear|ship)/i;

function reviewOf(body) {
  const first = body.split("\n").find((line) => line.trim().length > 0) ?? "";
  if (!/^#+\s/.test(first) || !/review|re-check|re-review/i.test(first)) return null;
  const kind = REVIEWERS.find(([, re]) => re.test(first));
  if (!kind) return null;
  const head = body.slice(0, 800);
  const verdict = head.match(/verdict[^a-z]*([a-z][a-z ]{2,40})/i)?.[1] ?? "";
  const outcome = BLOCKING.test(verdict) ? "blocking" : CONDITIONAL.test(verdict) ? "changes" : OK.test(verdict) ? "ok" : "unknown";
  return { reviewer: kind[0], outcome };
}

function failingTests(runId) {
  try {
    const log = execFileSync("gh", ["run", "view", String(runId), "--log-failed"], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
    const names = new Set();
    for (const line of log.split("\n")) {
      const found = line.match(/\d+\) (\[[a-z]+\] › .+?)\s*$/);
      if (found) names.add(found[1]);
    }
    return [...names];
  } catch (error) {
    process.stderr.write(`log unavailable for run ${runId}: ${error instanceof Error ? error.message.split("\n")[0] : "unknown"}\n`);
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
    const ci = runs
      .filter((r) => r.headBranch === pr.headRefName && r.workflowName === "ci" && r.event === "pull_request" && r.status === "completed")
      .sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt));
    const e2e = runs.filter((r) => r.headBranch === pr.headRefName && r.workflowName === "e2e" && r.status === "completed");
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
      ci_runs: ci.length,
      ci_failures: ci.filter((r) => r.conclusion !== "success").length,
      e2e_runs: e2e.length,
      e2e_failures: e2e.filter((r) => r.conclusion !== "success").length,
      e2e_failing_tests: e2e.filter((r) => r.conclusion === "failure").map((r) => ({ run: r.databaseId, tests: failingTests(r.databaseId) })),
    };
  })
  .sort((a, b) => a.pr - b.pr);

writeFileSync(out, JSON.stringify(rows));
process.stdout.write(`${rows.length} pull requests\n`);
