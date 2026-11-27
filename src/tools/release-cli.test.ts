import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { makeHarness, type Harness } from "./fake-gh";

const REPO = "kenneth-yu/trip-planner";
const tool = path.join(process.cwd(), "tools", "ci", "release.mjs");

function git(cwd: string, ...args: string[]): string {
  return execFileSync("git", ["-c", "user.email=t@example.invalid", "-c", "user.name=T", "-c", "commit.gpgsign=false", ...args], { cwd, encoding: "utf8", stdio: "pipe" }).trim();
}

function mergeCommit(harness: Harness, file: string, message: string, previousTag?: string): string {
  const target = path.join(harness.cwd, file);
  mkdirSync(path.dirname(target), { recursive: true });
  writeFileSync(target, `${message}\n`);
  git(harness.cwd, "add", "-A");
  git(harness.cwd, "commit", "-qm", message);
  git(harness.cwd, "push", "-q", "origin", "main");
  if (previousTag) {
    git(harness.cwd, "tag", previousTag, "HEAD~1");
    git(harness.cwd, "push", "-q", "origin", previousTag);
  }
  return git(harness.cwd, "rev-parse", "HEAD");
}

function pulls(sha: string, body = "") {
  return JSON.stringify([{ number: 5, title: "WP-99: Add a thing", html_url: `https://github.com/${REPO}/pull/5`, merged_at: "2026-11-27T10:00:00Z", merge_commit_sha: sha, body }]);
}

function release(harness: Harness, sha: string) {
  return harness.run(process.execPath, [tool], { SHA: sha, GH_REPO: REPO });
}

describe("release.mjs against a fake GitHub", () => {
  it("tags the next version from the previous tag by the level in the merge commit and releases with the pull request title", () => {
    const harness = makeHarness();
    const sha = mergeCommit(harness, "src/app/page.tsx", "Merge pull request #5 from kenneth-yu/wp/x\n\nSemver: minor", "v1.2.3");
    harness.setRoutes([{ match: `commits/${sha}/pulls`, out: pulls(sha) }, { match: "git/refs", out: "{}" }, { match: "release create", out: "" }]);
    const result = release(harness, sha);
    expect(result.status).toBe(0);
    const calls = harness.calls();
    expect(calls).toContain(`api -X POST repos/${REPO}/git/refs -f ref=refs/tags/v1.3.0 -f sha=${sha}`);
    expect(calls.find((c) => c.startsWith("release create"))).toContain("release create v1.3.0 --repo kenneth-yu/trip-planner --verify-tag --title WP-99: Add a thing");
  });

  it("reads the level from the merge commit only, never from the pull request body or a code fence", () => {
    const harness = makeHarness();
    const message = "Merge pull request #5 from kenneth-yu/wp/x\n\n```\nSemver: major\n```\nSemver: patch";
    const sha = mergeCommit(harness, "src/app/page.tsx", message, "v1.2.3");
    harness.setRoutes([{ match: `commits/${sha}/pulls`, out: pulls(sha, "Semver: major") }, { match: "git/refs", out: "{}" }, { match: "release create", out: "" }]);
    release(harness, sha);
    expect(harness.calls()).toContain(`api -X POST repos/${REPO}/git/refs -f ref=refs/tags/v1.2.4 -f sha=${sha}`);
  });

  it("does not release when the merge commit has no Semver line, even if the pull request body has one", () => {
    const harness = makeHarness();
    const sha = mergeCommit(harness, "src/app/page.tsx", "Merge pull request #5 from kenneth-yu/wp/x");
    harness.setRoutes([{ match: `commits/${sha}/pulls`, out: pulls(sha, "Semver: major") }]);
    const result = release(harness, sha);
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("no release");
    expect(harness.calls().some((c) => c.includes("git/refs") || c.startsWith("release create"))).toBe(false);
  });

  it("does not release when the merge changed no app path", () => {
    const harness = makeHarness();
    const sha = mergeCommit(harness, "tools/x.mjs", "Merge pull request #5 from kenneth-yu/wp/x\n\nSemver: minor");
    harness.setRoutes([{ match: `commits/${sha}/pulls`, out: pulls(sha) }]);
    const result = release(harness, sha);
    expect(result.stdout).toContain("changed no app path");
    expect(harness.calls().some((c) => c.includes("git/refs"))).toBe(false);
  });

  it("works the next tag out again once when the tag already exists, and fails loudly after that", () => {
    const harness = makeHarness();
    const sha = mergeCommit(harness, "src/app/page.tsx", "Merge pull request #5 from kenneth-yu/wp/x\n\nSemver: patch", "v1.0.0");
    harness.setRoutes([{ match: `commits/${sha}/pulls`, out: pulls(sha) }, { match: "git/refs", fail: "Reference already exists (422)", failTimes: 1 }, { match: "release create", out: "" }]);
    expect(release(harness, sha).status).toBe(0);
    expect(harness.calls().filter((c) => c.includes("git/refs"))).toHaveLength(2);

    const stubborn = makeHarness();
    const other = mergeCommit(stubborn, "src/app/page.tsx", "Merge pull request #5 from kenneth-yu/wp/x\n\nSemver: patch", "v1.0.0");
    stubborn.setRoutes([{ match: `commits/${other}/pulls`, out: pulls(other) }, { match: "git/refs", fail: "Reference already exists (422)" }]);
    expect(release(stubborn, other).status).not.toBe(0);
    expect(stubborn.calls().some((c) => c.startsWith("release create"))).toBe(false);
  });

  it("does nothing for a commit that is already tagged", () => {
    const harness = makeHarness();
    const sha = mergeCommit(harness, "src/app/page.tsx", "Merge pull request #5 from kenneth-yu/wp/x\n\nSemver: patch", "v1.0.0");
    git(harness.cwd, "tag", "v1.0.1", sha);
    harness.setRoutes([]);
    const result = release(harness, sha);
    expect(result.stdout).toContain("already tagged");
    expect(harness.calls()).toEqual([]);
  });

  it("refuses a commit that is not part of main, without tagging or releasing anything", () => {
    const harness = makeHarness();
    mergeCommit(harness, "src/app/page.tsx", "Merge pull request #4 from kenneth-yu/wp/y\n\nSemver: patch", "v1.0.0");
    git(harness.cwd, "switch", "-q", "-c", "side");
    const target = path.join(harness.cwd, "src/app/side.tsx");
    writeFileSync(target, "x\n");
    git(harness.cwd, "add", "-A");
    git(harness.cwd, "commit", "-qm", "Merge pull request #5 from kenneth-yu/wp/x\n\nSemver: major");
    const sha = git(harness.cwd, "rev-parse", "HEAD");
    harness.setRoutes([{ match: `commits/${sha}/pulls`, out: pulls(sha) }, { match: "git/refs", out: "{}" }, { match: "release create", out: "" }]);
    const result = release(harness, sha);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("is not part of main");
    expect(harness.calls()).toEqual([]);
  });

  it("refuses when the checkout has no origin/main to check against, because the commit then cannot be checked", () => {
    const harness = makeHarness();
    const sha = mergeCommit(harness, "src/app/page.tsx", "Merge pull request #5 from kenneth-yu/wp/x\n\nSemver: patch", "v1.0.0");
    git(harness.cwd, "update-ref", "-d", "refs/remotes/origin/main");
    harness.setRoutes([{ match: `commits/${sha}/pulls`, out: pulls(sha) }]);
    const result = release(harness, sha);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("could not be checked against main");
    expect(harness.calls()).toEqual([]);
  });

  it("refuses a sha that is not a full commit id", () => {
    const harness = makeHarness();
    expect(harness.run(process.execPath, [tool], { SHA: "abc", GH_REPO: REPO }).status).toBe(1);
  });
});
