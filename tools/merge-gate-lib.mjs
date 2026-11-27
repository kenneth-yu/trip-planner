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
  /^drizzle\.config\./,
  /(^|\/)schema\.ts$/,
  /(^|\/)nav\.tsx$/,
  /(^|\/)layout\.tsx$/,
  /^src\/proxy\.ts$/,
  /(^|\/)package(-lock)?\.json$/,
  /^next\.config\./,
  /^eslint\.config\./,
  /^vitest\.config\./,
  /^playwright\.config\./,
  /^\.github\//,
  /^\.claude\//,
  /^\.gitleaks(ignore|\.toml)$/,
  /^CLAUDE\.md$/,
  /^docs\/PIPELINE\.md$/,
  /^tsconfig\.json$/,
  /^vercel\.json$/,
  /^scripts\/build/,
  /^tools\/merge-gate/,
];

const VOCABULARY = {
  approve: { positive: "approve", conditional: "approve with changes", negative: "send back" },
  clear: { positive: "clear", conditional: "clear with fixes", negative: "blocked" },
};

const REVIEWERS = [
  { key: "qa", label: "QA", heading: /^##\s+QA review(\s+re-review)?(\s*\(.*\))?\s*$/i, words: VOCABULARY.approve },
  { key: "security", label: "Security", heading: /^##\s+Security review(\s+re-review)?(\s*\(.*\))?\s*$/i, words: VOCABULARY.clear },
  { key: "product", label: "Product", heading: /^##\s+Product review(\s+re-review)?(\s*\(.*\))?\s*$/i, words: VOCABULARY.approve },
  { key: "ux", label: "UX lead", heading: /^##\s+UX review\s*\(lead\)(\s+re-review)?(\s*\(.*\))?\s*$/i, words: VOCABULARY.approve },
];

export function isIntegrationPath(path) {
  return INTEGRATION_PATHS.some((pattern) => pattern.test(path));
}

export function touchesUserInterface(paths) {
  return paths.some((path) => path.startsWith("src/app/") || path.endsWith(".css"));
}

function lines(body) {
  return body.split("\n").map((line) => line.trim());
}

export function parseVerdict(body) {
  const [heading, ...rest] = lines(body).filter((line) => line.length > 0);
  const reviewer = REVIEWERS.find((r) => heading && r.heading.test(heading));
  if (!reviewer) return null;
  const first = (rest[0] ?? "").replace(/\*/g, "").trim().toLowerCase();
  const match = first.match(/^verdict:\s*(.*)$/);
  const text = match ? match[1] : "";
  const word = [reviewer.words.conditional, reviewer.words.negative, reviewer.words.positive].find((w) => text === w || text.startsWith(`${w} `) || text.startsWith(`${w}.`) || text.startsWith(`${w}(`) || text.startsWith(`${w},`));
  let outcome = "unknown";
  if (word === reviewer.words.positive) outcome = "positive";
  else if (word === reviewer.words.conditional) outcome = "conditional";
  else if (word === reviewer.words.negative) outcome = "negative";
  const reviewed = text.match(/\bat\s+([0-9a-f]{7,40})\b/);
  return { reviewer: reviewer.key, label: reviewer.label, outcome, reviewedSha: reviewed ? reviewed[1] : null, text: text.replace(/[^\x20-\x7e]/g, "").slice(0, 80) };
}

const NAMES = { qa: /^qa\b/i, security: /^security\b/i, product: /^product\b/i, ux: /^ux\b/i };

export function isReplyTo(reviewer, body) {
  if (parseVerdict(body)) return false;
  return lines(body).some((line) => {
    const plain = line.replace(/^[-*\d.)\s]+/, "").replace(/\*/g, "");
    return NAMES[reviewer].test(plain) && /\b(applied|declined)\b/i.test(plain);
  });
}

function reasonsForChecks(checkRuns) {
  const latest = new Map();
  for (const run of checkRuns) {
    if (run.appSlug !== "github-actions") continue;
    const seen = latest.get(run.name);
    if (!seen || run.id > seen.id) latest.set(run.name, run);
  }
  const reasons = [];
  for (const name of REQUIRED_CHECKS) {
    const run = latest.get(name);
    if (!run) reasons.push(`Required check "${name}" has not reported on the head.`);
    else if (run.status !== "completed" || run.conclusion !== "success") reasons.push(`Required check "${name}" is not green (${run.status === "completed" ? run.conclusion : run.status}).`);
  }
  return reasons;
}

function isVerifiedMerge(commit, verifiedMerges) {
  return commit.parents.length === 2 && verifiedMerges.has(commit.sha);
}

export function lastCodeCommit(commits, verifiedMerges) {
  const code = commits.filter((commit) => !isVerifiedMerge(commit, verifiedMerges));
  return code.length > 0 ? code[code.length - 1] : null;
}

function reasonsForVerdicts(input, paths) {
  const required = REVIEWERS.filter((r) => r.key !== "ux" || touchesUserInterface(paths));
  const trusted = input.comments
    .filter((c) => c.author === input.reviewerLogin && c.authorType !== "Bot")
    .map((c) => ({ ...c, time: Date.parse(c.updatedAt) }))
    .sort((a, b) => a.time - b.time);
  const lastCode = lastCodeCommit(input.commits, input.verifiedMerges);
  const reasons = [];
  for (const reviewer of required) {
    const verdicts = trusted.map((comment) => ({ comment, verdict: parseVerdict(comment.body) })).filter((x) => x.verdict && x.verdict.reviewer === reviewer.key);
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
    if (!verdict.reviewedSha) {
      reasons.push(`The ${reviewer.label} verdict does not name the commit it reviewed. Use "Verdict: <word> at <sha>".`);
      continue;
    }
    const index = input.commits.findIndex((c) => c.sha.startsWith(verdict.reviewedSha));
    if (index < 0) {
      reasons.push(`The ${reviewer.label} verdict names a commit that is not in this pull request.`);
      continue;
    }
    if (verdict.outcome === "positive") {
      const after = input.commits.slice(index + 1);
      if (!after.every((c) => isVerifiedMerge(c, input.verifiedMerges))) {
        reasons.push(`The ${reviewer.label} verdict is older than the head: it reviewed ${verdict.reviewedSha.slice(0, 7)} and code was pushed after it.`);
      }
      continue;
    }
    const reply = trusted.find((c) => c.time > comment.time && isReplyTo(reviewer.key, c.body));
    if (!reply) {
      reasons.push(`The latest ${reviewer.label} verdict asks for changes ("${verdict.text}") and no reply naming ${reviewer.label} with Applied or Declined follows it.`);
      continue;
    }
    if (lastCode && !input.commits.slice(0, index + 1).includes(lastCode)) {
      if (typeof input.lastCodePushedAt !== "number" || !Number.isFinite(input.lastCodePushedAt)) {
        reasons.push(`Could not tell when the latest code was pushed, so the ${reviewer.label} reply cannot be checked.`);
      } else if (reply.time <= input.lastCodePushedAt) {
        reasons.push(`The ${reviewer.label} verdict is older than the head: code was pushed after the Applied/Declined reply.`);
      }
    }
  }
  return reasons;
}

export function evaluate(input) {
  const paths = input.files.flatMap((f) => [f.filename, f.previousFilename].filter((p) => typeof p === "string"));
  const reasons = [];
  reasons.push(...reasonsForChecks(input.checkRuns));
  if (!Number.isInteger(input.behindBy)) reasons.push("Could not tell whether the branch is behind main.");
  else if (input.behindBy > 0) reasons.push(`The branch is ${input.behindBy} commit(s) behind main. Merge origin/main into it.`);
  if (input.files.length !== input.changedFiles) reasons.push(`Only ${input.files.length} of ${input.changedFiles} changed files could be read, so integration paths cannot be ruled out.`);
  reasons.push(...reasonsForVerdicts(input, paths));
  const owned = [...new Set(paths.filter(isIntegrationPath))];
  if (owned.length > 0) reasons.push(`The pull request touches integration-owned paths: ${owned.join(", ")}. The architect merges it.`);
  return { ok: reasons.length === 0, reasons };
}
