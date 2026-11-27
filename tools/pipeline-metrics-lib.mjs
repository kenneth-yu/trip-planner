const HEADING = /^##\s+(QA|Security|Product|UX) review(?:\s*\((?:phone|desktop|lead)\))?(?:\s+re-review)?(?:\s*\(.*\))?\s*$/i;

const WORDS = {
  qa: { blocking: "send back", changes: "approve with changes", ok: "approve" },
  product: { blocking: "send back", changes: "approve with changes", ok: "approve" },
  ux: { blocking: "send back", changes: "approve with changes", ok: "approve" },
  security: { blocking: "blocked", changes: "clear with fixes", ok: "clear" },
};

const LOG_LINE = /^[^\t]*\t[^\t]*\t\d{4}-\d{2}-\d{2}T[\d:.]+Z\s+\d+\) \[[a-z]+\] › (.+?)\s*$/;
const MAX_NAME = 200;

export function reviewOf(body) {
  const [heading, ...rest] = body.split("\n").map((line) => line.trim()).filter((line) => line.length > 0);
  const found = heading ? heading.match(HEADING) : null;
  if (!found) return null;
  const reviewer = found[1].toLowerCase();
  const first = (rest[0] ?? "").replace(/\*/g, "").toLowerCase();
  const text = first.startsWith("verdict:") ? first.slice("verdict:".length).trim() : "";
  const words = WORDS[reviewer];
  const matches = (word) => text === word || (text.startsWith(word) && !/[a-z]/.test(text.charAt(word.length)));
  const outcome = matches(words.changes) ? "changes" : matches(words.blocking) ? "blocking" : matches(words.ok) ? "ok" : "unknown";
  return { reviewer, outcome };
}

export function failingTestNames(log) {
  const names = new Set();
  for (const line of log.split("\n")) {
    const found = line.match(LOG_LINE);
    if (found) names.add(found[1].replace(/(\.spec\.ts):\d+:\d+/g, "$1").slice(0, MAX_NAME));
  }
  return names.size > 0 ? [...names] : null;
}

export function countRuns(runs) {
  return {
    total: runs.length,
    failures: runs.filter((r) => r.conclusion === "failure").length,
    cancelled: runs.filter((r) => r.conclusion === "cancelled").length,
  };
}

export function runsForPullRequest(runs, commitShas) {
  const shas = new Set(commitShas);
  return runs.filter((r) => shas.has(r.headSha));
}
