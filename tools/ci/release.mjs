import { execFileSync } from "node:child_process";
import { semverOf } from "../merge-gate-lib.mjs";
import { latestTag, mergedPullRequestFor, nextTag } from "./release-lib.mjs";

const REPO = process.env.GH_REPO || "kenneth-yu/trip-planner";
const SHA = process.env.SHA;
if (!SHA || !/^[0-9a-f]{40}$/.test(SHA)) {
  process.stderr.write("SHA is missing or is not a full commit id.\n");
  process.exit(1);
}

function run(command, parameters) {
  return execFileSync(command, parameters, { encoding: "utf8", timeout: 120000 }).trim();
}

const existing = run("git", ["tag", "--points-at", SHA, "--list", "v*.*.*"]);
if (existing) {
  process.stdout.write(`${SHA} is already tagged ${existing}.\n`);
  process.exit(0);
}

const pulls = JSON.parse(run("gh", ["api", `repos/${REPO}/commits/${SHA}/pulls`]));
const pull = mergedPullRequestFor(SHA, pulls);
if (!pull) {
  process.stdout.write("This commit is not the merge commit of one pull request: no release.\n");
  process.exit(0);
}
const semver = semverOf(pull.body);
if (!semver.level) {
  process.stdout.write(`Pull request ${pull.number} ${semver.problem}: no release.\n`);
  process.exit(0);
}

const tag = nextTag(latestTag(run("git", ["tag", "--list", "v*.*.*"]).split("\n")), semver.level);
run("gh", ["release", "create", tag, "--repo", REPO, "--target", SHA, "--title", pull.title, "--notes", `Pull request #${pull.number}: ${pull.html_url}\n\nSemver: ${semver.level}`]);
process.stdout.write(`Released ${tag} for pull request ${pull.number} (${semver.level}).\n`);
