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
  return { reviewer: reviewer.key, label: reviewer.label, outcome, text: text.replace(/[^\x20-\x7e]/g, "").slice(0, 80) };
}

export function isReply(body) {
  if (parseVerdict(body)) return false;
  return lines(body).some((line) => {
    const plain = line.replace(/^[-*\d.)\s]+/, "").replace(/\*/g, "");
    return /^(applied|declined)\b/i.test(plain) || /:\s*(applied|declined)\b/i.test(plain);
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

function effectiveDates(commits) {
  let newest = Number.NEGATIVE_INFINITY;
  return commits.map((commit) => {
    newest = Math.max(newest, Date.parse(commit.committedAt));
    return { commit, at: newest };
  });
}

function reasonsForVerdicts(input, paths) {
  const required = REVIEWERS.filter((r) => r.key !== "ux" || touchesUserInterface(paths));
  const trusted = input.comments
    .filter((c) => c.author === input.reviewerLogin && c.authorType !== "Bot")
    .map((c) => ({ ...c, time: Date.parse(c.updatedAt) }))
    .sort((a, b) => a.time - b.time);
  const code = effectiveDates(input.commits).filter(({ commit }) => !(commit.parents.length === 2 && input.mainAncestors.has(commit.parents[1])));
  const lastCodeAt = code.reduce((newest, { at }) => Math.max(newest, at), Number.NEGATIVE_INFINITY);
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
    let standsAt = comment.time;
    if (verdict.outcome === "conditional") {
      const reply = trusted.find((c) => c.time > comment.time && isReply(c.body));
      if (!reply) {
        reasons.push(`The latest ${reviewer.label} verdict asks for changes ("${verdict.text}") and no Applied/Declined reply follows it.`);
        continue;
      }
      standsAt = reply.time;
    }
    if (lastCodeAt > standsAt) {
      reasons.push(`The ${reviewer.label} verdict is older than the head: code was pushed after ${verdict.outcome === "conditional" ? "the Applied/Declined reply" : "it"}.`);
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
