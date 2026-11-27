const TAG = /^v(\d+)\.(\d+)\.(\d+)$/;

export function latestTag(tags) {
  const versions = tags
    .map((tag) => TAG.exec(tag))
    .filter((match) => match !== null)
    .map((match) => [Number(match[1]), Number(match[2]), Number(match[3])]);
  if (versions.length === 0) return null;
  versions.sort((a, b) => a[0] - b[0] || a[1] - b[1] || a[2] - b[2]);
  const [major, minor, patch] = versions[versions.length - 1];
  return `v${major}.${minor}.${patch}`;
}

export function nextTag(previous, level) {
  const match = previous === null ? [null, "0", "0", "0"] : TAG.exec(previous);
  if (match === null) throw new Error("The previous tag is not a version.");
  const [major, minor, patch] = [Number(match[1]), Number(match[2]), Number(match[3])];
  if (level === "major") return `v${major + 1}.0.0`;
  if (level === "minor") return `v${major}.${minor + 1}.0`;
  if (level === "patch") return `v${major}.${minor}.${patch + 1}`;
  throw new Error("The level is not major, minor or patch.");
}

export function mergedPullRequestFor(sha, pulls) {
  const merged = pulls.filter((pull) => pull.merged_at && pull.merge_commit_sha === sha);
  return merged.length === 1 ? merged[0] : null;
}
