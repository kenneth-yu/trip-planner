import { describe, expect, it } from "vitest";
import { latestTag, mergedPullRequestFor, nextTag } from "../../tools/ci/release-lib.mjs";

describe("release tags", () => {
  it("bumps from the previous tag by the declared level", () => {
    expect(nextTag("v1.4.7", "patch")).toBe("v1.4.8");
    expect(nextTag("v1.4.7", "minor")).toBe("v1.5.0");
    expect(nextTag("v1.4.7", "major")).toBe("v2.0.0");
  });

  it("starts from 0.0.0 when there is no tag yet", () => {
    expect(nextTag(null, "patch")).toBe("v0.0.1");
    expect(nextTag(null, "minor")).toBe("v0.1.0");
    expect(nextTag(null, "major")).toBe("v1.0.0");
  });

  it("refuses an unknown level or a previous tag that is not a version", () => {
    expect(() => nextTag("v1.0.0", "huge")).toThrow();
    expect(() => nextTag("latest", "patch")).toThrow();
  });

  it("finds the newest version by number, not by text, and ignores other tags", () => {
    expect(latestTag(["v1.9.0", "v1.10.0", "v1.2.30", "nightly", "v2", ""])).toBe("v1.10.0");
    expect(latestTag(["nightly", ""])).toBeNull();
    expect(latestTag([])).toBeNull();
  });
});

describe("the pull request behind a commit", () => {
  const sha = "a".repeat(40);

  it("is the one merged pull request whose merge commit is this commit", () => {
    const pulls = [
      { number: 1, merged_at: null, merge_commit_sha: sha },
      { number: 2, merged_at: "2026-11-27T10:00:00Z", merge_commit_sha: "b".repeat(40) },
      { number: 3, merged_at: "2026-11-27T10:00:00Z", merge_commit_sha: sha },
    ];
    expect(mergedPullRequestFor(sha, pulls)?.number).toBe(3);
  });

  it("is nothing when no pull request or more than one matches", () => {
    expect(mergedPullRequestFor(sha, [])).toBeNull();
    const twin = { merged_at: "2026-11-27T10:00:00Z", merge_commit_sha: sha };
    expect(mergedPullRequestFor(sha, [{ number: 1, ...twin }, { number: 2, ...twin }])).toBeNull();
  });
});
