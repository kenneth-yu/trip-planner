export const REQUIRED_CHECKS = [
  "lint",
  "typecheck",
  "test",
  "build",
  "audit",
  "migrations",
  "statecharts",
  "postgres",
  "prod-guard",
  "gitleaks",
  "e2e phone",
];

const INTEGRATION_PATHS = [
  /^drizzle\//,
  /(^|\/)schema\.ts$/,
  /(^|\/)nav\.tsx$/,
  /(^|\/)layout\.tsx$/,
  /(^|\/)package(-lock)?\.json$/,
  /^next\.config\./,
  /^eslint\.config\./,
  /^vitest\.config\./,
  /^playwright\.config\./,
  /^\.github\//,
  /^\.claude\//,
  /^CLAUDE\.md$/,
  /^docs\/PIPELINE\.md$/,
  /^tsconfig\.json$/,
  /^vercel\.json$/,
  /^scripts\/build/,
];

const REVIEWERS = [
  { key: "qa", label: "QA", heading: /^#+\s*QA review/i },
  { key: "security", label: "Security", heading: /^#+\s*Security review/i },
  { key: "product", label: "Product", heading: /^#+\s*Product review/i },
  { key: "ux", label: "UX lead", heading: /^#+\s*UX review\s*\(lead\)/i },
];

const MERGE_OF_MAIN = /^Merge (branch|remote-tracking branch|pull request)/i;

export function isIntegrationPath(path) {
  return INTEGRATION_PATHS.some((pattern) => pattern.test(path));
}

export function touchesUserInterface(paths) {
  return paths.some((path) => path.startsWith("src/app/") || path.endsWith(".css"));
}

function firstLine(body) {
  return body.split("\n").find((line) => line.trim().length > 0) ?? "";
}

export function parseVerdict(body) {
  const reviewer = REVIEWERS.find((r) => r.heading.test(firstLine(body)));
  if (!reviewer) return null;
  const match = body.match(/verdict:?\**\s*([^\n]*)/i);
  const text = (match ? match[1] : "").replace(/\*/g, "").toLowerCase();
  let outcome = "unknown";
  if (/(send back|not ready|blocked|rethink|reject)/.test(text)) outcome = "negative";
  else if (/(with changes|with fixes|ready with|clear with|approve with)/.test(text)) outcome = "conditional";
  else if (/^(approve|approved|clear|ready|ship)/.test(text.trim())) outcome = "positive";
  return { reviewer: reviewer.key, label: reviewer.label, outcome, text: text.trim() };
}

function checkName(entry) {
  return entry.name ?? entry.context ?? "";
}

function checkGreen(entry) {
  return (entry.conclusion ?? entry.state ?? "").toUpperCase() === "SUCCESS";
}

function reasonsForChecks(rollup) {
  const byName = new Map(rollup.map((entry) => [checkName(entry), entry]));
  const reasons = [];
  for (const name of REQUIRED_CHECKS) {
    const entry = byName.get(name);
    if (!entry) reasons.push(`Required check "${name}" has not reported on the head.`);
    else if (!checkGreen(entry)) reasons.push(`Required check "${name}" is not green (${(entry.conclusion ?? entry.state ?? entry.status ?? "pending").toLowerCase()}).`);
  }
  return reasons;
}

function reasonsForVerdicts(input, paths) {
  const required = REVIEWERS.filter((r) => r.key !== "ux" || touchesUserInterface(paths));
  const comments = [...input.comments].sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt));
  const headCommit = input.commits[input.commits.length - 1];
  const reasons = [];
  for (const reviewer of required) {
    const verdicts = comments.map((c) => ({ comment: c, verdict: parseVerdict(c.body) })).filter((x) => x.verdict && x.verdict.reviewer === reviewer.key);
    const latest = verdicts[verdicts.length - 1];
    if (!latest) {
      reasons.push(`No ${reviewer.label} review verdict on the pull request.`);
      continue;
    }
    const { comment, verdict } = latest;
    if (verdict.outcome === "negative" || verdict.outcome === "unknown") {
      reasons.push(`The latest ${reviewer.label} verdict is not positive ("${verdict.text || "no verdict line"}").`);
      continue;
    }
    if (verdict.outcome === "conditional") {
      const answered = comments.some((c) => Date.parse(c.createdAt) > Date.parse(comment.createdAt) && !parseVerdict(c.body) && /\b(applied|declined)\b/i.test(c.body));
      if (!answered) {
        reasons.push(`The latest ${reviewer.label} verdict asks for changes ("${verdict.text}") and no Applied/Declined reply follows it.`);
        continue;
      }
    }
    const later = input.commits.filter((c) => Date.parse(c.committedDate) > Date.parse(comment.createdAt));
    const fromDiff = /from the diff/i.test(comment.body);
    const onlyMerges = later.every((c) => MERGE_OF_MAIN.test(c.messageHeadline));
    if (headCommit && later.length > 0 && !fromDiff && !onlyMerges) {
      reasons.push(`The ${reviewer.label} verdict is older than the head: ${later.length} commit(s) landed after it.`);
    }
  }
  return reasons;
}

export function evaluate(input) {
  const paths = input.files.map((f) => f.path);
  const reasons = [];
  reasons.push(...reasonsForChecks(input.statusCheckRollup));
  if (input.behindBy > 0) reasons.push(`The branch is ${input.behindBy} commit(s) behind main. Merge origin/main into it.`);
  reasons.push(...reasonsForVerdicts(input, paths));
  const owned = paths.filter(isIntegrationPath);
  if (owned.length > 0) reasons.push(`The pull request touches integration-owned paths: ${owned.join(", ")}. The architect merges it.`);
  return { ok: reasons.length === 0, reasons };
}
