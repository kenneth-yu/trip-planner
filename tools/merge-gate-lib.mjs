import { readFileSync } from "node:fs";

export const CONFIG = JSON.parse(readFileSync(new URL("./merge-gate-config.json", import.meta.url), "utf8"));

export const REQUIRED_CHECKS = CONFIG.requiredChecks;

const compile = (patterns) => patterns.map((pattern) => new RegExp(pattern));
const DOCS_ONLY = compile(CONFIG.docsOnly);
const OWNER_ONLY = compile(CONFIG.ownerOnly);
const WORKFLOW_FILES = compile(CONFIG.workflowFiles);
const SEMVER_PATHS = compile(CONFIG.semver.paths);
const SEMVER_EXCLUDE = compile(CONFIG.semver.exclude);
const MAPPING = Object.fromEntries(Object.entries(CONFIG.reviewers).map(([key, rule]) => [key, { paths: compile(rule.paths), exclude: compile(rule.exclude) }]));

export class GateDataError extends Error {
  constructor(message) {
    super(message);
    this.name = "GateDataError";
  }
}

const VOCABULARY = {
  approve: { positive: "approve", conditional: "approve with changes", negative: "send back" },
  clear: { positive: "clear", conditional: "clear with fixes", negative: "blocked" },
};

const REVIEWERS = [
  { key: "qa", label: "QA", heading: /^##\s+QA review(\s+re-review)?(\s*\(.*\))?\s*$/i, words: VOCABULARY.approve },
  { key: "security", label: "Security", heading: /^##\s+Security review(\s+re-review)?(\s*\(.*\))?\s*$/i, words: VOCABULARY.clear },
  { key: "product", label: "Product", heading: /^##\s+Product review(\s+re-review)?(\s*\(.*\))?\s*$/i, words: VOCABULARY.approve },
  { key: "ux", label: "UX lead", heading: /^##\s+UX review\s*\(lead\)(\s+re-review)?(\s*\(.*\))?\s*$/i, words: VOCABULARY.approve },
  { key: "architect", label: "Architect", heading: /^##\s+Architect review(\s+re-review)?(\s*\(.*\))?\s*$/i, words: VOCABULARY.approve },
];

export function isIntegrationPath(path) {
  return MAPPING.architect.paths.some((pattern) => pattern.test(path));
}

export function isDocsOnly(paths) {
  return paths.length > 0 && paths.every((path) => DOCS_ONLY.some((pattern) => pattern.test(path)));
}

export function requiredReviewers(paths) {
  if (isDocsOnly(paths)) return [];
  return Object.keys(MAPPING).filter((key) => paths.some((path) => MAPPING[key].paths.some((p) => p.test(path)) && !MAPPING[key].exclude.some((p) => p.test(path))));
}

export function touchesWorkflowFiles(paths) {
  return paths.some((path) => WORKFLOW_FILES.some((pattern) => pattern.test(path)));
}

export const WORKFLOW_REASON = "The pull request touches workflow files: needs the owner to merge.";

export function isWorkflowRefusal(text) {
  return /\.github\/workflows/i.test(text) || /\bworkflows?\b[^\n]*\bscope\b|\bscope\b[^\n]*\bworkflows?\b/i.test(text);
}

export function touchesOwnerOnly(paths) {
  return paths.some((path) => OWNER_ONLY.some((pattern) => pattern.test(path)));
}

export function changesApp(paths) {
  return paths.some((path) => SEMVER_PATHS.some((p) => p.test(path)) && !SEMVER_EXCLUDE.some((p) => p.test(path)));
}

function outsideCodeFences(text) {
  let fenced = false;
  const kept = [];
  for (const line of (text ?? "").split("\n")) {
    if (/^\s*(```|~~~)/.test(line)) {
      fenced = !fenced;
      continue;
    }
    if (!fenced) kept.push(line);
  }
  return kept;
}

export function semverOf(body) {
  const declared = outsideCodeFences(body).map((line) => line.trim()).filter((line) => /^semver:/i.test(line));
  if (declared.length !== 1) return { level: null, problem: declared.length === 0 ? "has no Semver line" : "has more than one Semver line" };
  const match = declared[0].match(/^semver:\s*(major|minor|patch)\s*$/i);
  return match ? { level: match[1].toLowerCase(), problem: null } : { level: null, problem: "has a Semver line that is not major, minor or patch" };
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

const NAMES = { qa: /^qa\b/i, security: /^security\b/i, product: /^product\b/i, ux: /^ux\b/i, architect: /^architect\b/i };

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
    else if (run.status !== "completed" || !["success", "skipped"].includes(run.conclusion)) reasons.push(`Required check "${name}" is not green (${run.status === "completed" ? run.conclusion : run.status}).`);
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
  const needed = new Set(requiredReviewers(paths));
  const required = REVIEWERS.filter((r) => needed.has(r.key));
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
  const labels = input.labels ?? [];
  const held = CONFIG.holdLabels.filter((label) => labels.includes(label));
  if (held.length > 0) reasons.push(`The pull request carries the ${held.map((l) => `"${l}"`).join(" and ")} label.`);
  const ownerOnly = touchesOwnerOnly(paths);
  if (ownerOnly) reasons.push("The pull request touches .claude/ or CLAUDE.md, which only the owner may merge.");
  const workflowFiles = touchesWorkflowFiles(paths);
  if (workflowFiles) reasons.push(WORKFLOW_REASON);
  reasons.push(...reasonsForChecks(input.checkRuns));
  if (input.files.length !== input.changedFiles) reasons.push(`Only ${input.files.length} of ${input.changedFiles} changed files could be read, so the reviewers it needs cannot be worked out.`);
  reasons.push(...reasonsForVerdicts(input, paths));
  if (changesApp(paths)) {
    const semver = semverOf(input.body);
    if (semver.problem) reasons.push(`The pull request body ${semver.problem}. A pull request that changes the app needs exactly one line "Semver: major", "Semver: minor" or "Semver: patch".`);
  }
  const behindKnown = Number.isInteger(input.behindBy);
  if (!behindKnown) reasons.push("Could not tell whether the branch is behind main.");
  return { ok: reasons.length === 0, reasons, behind: behindKnown && input.behindBy > 0, needsOwner: ownerOnly || workflowFiles, held: held.length > 0 };
}

function need(condition, message) {
  if (!condition) throw new GateDataError(message);
}

export const HOLD_LABELS = CONFIG.holdLabels;

export function buildInput(raw, reviewerLogin, repo) {
  const { pr, files, comments, commits, checkRuns, checkRunsTotal, compare } = raw;
  need(pr && typeof pr === "object", "The pull request could not be read.");
  need(typeof pr.head?.sha === "string" && /^[0-9a-f]{40}$/.test(pr.head.sha), "The head commit id is missing or malformed.");
  need(pr.state === "open" && pr.base?.ref === "main", "The pull request is not an open pull request against main.");
  need(typeof pr.draft === "boolean", "Whether the pull request is a draft is missing.");
  need(pr.draft === false, "The pull request is a draft.");
  need(typeof repo === "string" && pr.head?.repo?.full_name === repo, "The pull request does not come from this repository.");
  need(Number.isInteger(pr.changed_files), "The changed file count is missing.");
  need(Number.isInteger(pr.commits), "The commit count is missing.");
  need(Array.isArray(pr.labels), "The labels are missing.");
  need(Array.isArray(files) && files.every((f) => typeof f.filename === "string"), "The changed files could not be listed.");
  need(files.length === pr.changed_files, `Only ${files.length} of ${pr.changed_files} changed files could be listed.`);
  need(Array.isArray(commits) && commits.every((c) => typeof c.sha === "string" && Array.isArray(c.parents)), "The commits could not be listed.");
  need(commits.length === pr.commits, `Only ${commits.length} of ${pr.commits} commits could be listed.`);
  need(commits.length > 0 && commits[commits.length - 1].sha === pr.head.sha, "The last listed commit is not the head, so the commit list is not current.");
  need(Array.isArray(comments) && comments.every((c) => typeof c.user?.login === "string" && typeof c.updated_at === "string" && typeof c.body === "string"), "The comments could not be read.");
  need(Array.isArray(checkRuns) && Number.isInteger(checkRunsTotal) && checkRuns.length === checkRunsTotal, "The check runs could not all be read.");
  need(Number.isInteger(compare?.behind_by), "How far the branch is behind main could not be read.");
  need(typeof reviewerLogin === "string" && reviewerLogin.length > 0, "The trusted reviewer account is not known.");
  return {
    reviewerLogin,
    labels: pr.labels.map((l) => l.name),
    body: pr.body ?? "",
    files: files.map((f) => ({ filename: f.filename, previousFilename: f.previous_filename })),
    changedFiles: pr.changed_files,
    comments: comments.map((c) => ({ author: c.user.login, authorType: c.user.type, body: c.body, updatedAt: c.updated_at })),
    commits: commits.map((c) => ({ sha: c.sha, parents: c.parents.map((p) => p.sha) })),
    checkRuns: checkRuns.map((r) => ({ id: r.id, name: r.name, status: r.status, conclusion: r.conclusion, appSlug: r.app ? r.app.slug : "" })),
    behindBy: compare.behind_by,
    verifiedMerges: raw.verifiedMerges ?? new Set(),
    lastCodePushedAt: raw.lastCodePushedAt ?? null,
  };
}
