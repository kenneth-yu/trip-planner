export const LISTING_CAP = 3000;

const DOCS_ONLY = [/^docs\/(?!STATECHARTS\.md$).+\.md$/, /^[^/]+\.md$/, /^\.pipeline\//];

const PERF_PATHS = [
  /^src\/app\//,
  /^src\/server\//,
  /^src\/components\//,
  /^src\/lib\//,
  /^src\/domain\//,
  /^src\/proxy\.ts$/,
  /^src\/instrumentation\.ts$/,
  /^drizzle\//,
  /^perf\//,
  /^next\.config\./,
  /^package\.json$/,
  /^package-lock\.json$/,
  /^lighthouserc\.json$/,
  /^vitest\.perf\.config\.mts$/,
  /^scripts\/bundle-budget\.ts$/,
  /^\.github\/workflows\/perf\.yml$/,
];

function listingTrusted(files, total) {
  if (!Array.isArray(files) || files.length === 0) return false;
  if (!Number.isInteger(total) || total >= LISTING_CAP) return false;
  return true;
}

export function isDocsPath(path) {
  return DOCS_ONLY.some((pattern) => pattern.test(path));
}

export function codeChanged({ files, total }) {
  if (!listingTrusted(files, total)) return true;
  return !files.every(isDocsPath);
}

export function perfNeeded({ files, total, labels }) {
  if (Array.isArray(labels) && labels.includes("perf")) return true;
  if (!listingTrusted(files, total)) return true;
  return files.some((path) => PERF_PATHS.some((pattern) => pattern.test(path)));
}
