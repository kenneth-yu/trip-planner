import { execFileSync } from "node:child_process";
import { changesApp, semverOf } from "../merge-gate-lib.mjs";
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

function done(message) {
  process.stdout.write(`${message}\n`);
  process.exit(0);
}

function tags() {
  run("git", ["fetch", "--tags", "--force", "--quiet", "origin"]);
  return run("git", ["tag", "--list", "v*.*.*"]).split("\n");
}

if (run("git", ["tag", "--points-at", SHA, "--list", "v*.*.*"])) done(`${SHA} is already tagged.`);

const message = run("git", ["log", "-1", "--format=%B", SHA]);
const body = message.split("\n").slice(1).join("\n");
const semver = semverOf(body);
if (!semver.level) done(`The merge commit message ${semver.problem}: no release.`);

const changed = run("git", ["diff", "--name-only", "--no-renames", `${SHA}^1`, SHA]).split("\n").filter((line) => line.length > 0);
if (!changesApp(changed)) done("The merge changed no app path: no release.");

const pull = mergedPullRequestFor(SHA, JSON.parse(run("gh", ["api", `repos/${REPO}/commits/${SHA}/pulls`])));
const title = pull ? pull.title : message.split("\n")[0];
const notes = pull ? `Pull request #${pull.number}: ${pull.html_url}\n\nSemver: ${semver.level}` : `Semver: ${semver.level}`;

function createTag() {
  const tag = nextTag(latestTag(tags()), semver.level);
  run("gh", ["api", "-X", "POST", `repos/${REPO}/git/refs`, "-f", `ref=refs/tags/${tag}`, "-f", `sha=${SHA}`]);
  return tag;
}

let tag;
try {
  tag = createTag();
} catch (error) {
  process.stdout.write(`The tag could not be created (${error instanceof Error ? error.message.split("\n")[0].slice(0, 120) : "unknown error"}); working out the next one again.\n`);
  tag = createTag();
}
run("gh", ["release", "create", tag, "--repo", REPO, "--verify-tag", "--title", title, "--notes", notes]);
done(`Released ${tag} (${semver.level}).`);
