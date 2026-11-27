import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

const SCRIPT = path.join(import.meta.dirname, "..", "..", "tools", "ci", "vercel-ignore.sh");

function repoWith(changed: string): string {
  const dir = mkdtempSync(path.join(tmpdir(), "vercel-ignore-"));
  const git = (...args: string[]) => execFileSync("git", args, { cwd: dir, stdio: "pipe" });
  git("init", "-q");
  git("config", "user.email", "test@example.invalid");
  git("config", "user.name", "Test");
  writeFileSync(path.join(dir, "README.md"), "start\n");
  git("add", ".");
  git("commit", "-qm", "start");
  mkdirSync(path.dirname(path.join(dir, changed)), { recursive: true });
  writeFileSync(path.join(dir, changed), "change\n");
  git("add", ".");
  git("commit", "-qm", "change");
  return dir;
}

function decide(changed: string, env: Record<string, string> = {}): "build" | "skip" {
  const result = spawnSync("bash", [SCRIPT], { cwd: repoWith(changed), env: { ...process.env, VERCEL_ENV: "", VERCEL_GIT_COMMIT_REF: "", ...env }, encoding: "utf8" });
  if (result.status === 0) return "skip";
  if (result.status === 1) return "build";
  throw new Error(`vercel-ignore.sh exited ${result.status}: ${result.stderr}`);
}

describe("Vercel ignore rule", () => {
  it("builds a commit that changes app code, public files or dependencies", () => {
    expect(decide("src/app/page.tsx")).toBe("build");
    expect(decide("src/server/services/trip-service.ts")).toBe("build");
    expect(decide("public/icon.svg")).toBe("build");
    expect(decide("package-lock.json")).toBe("build");
    expect(decide("drizzle/0008_x.sql")).toBe("build");
  });

  it("skips a commit that changes only tests, e2e, docs, CI or tooling", () => {
    expect(decide("src/server/auth/auth.test.ts")).toBe("skip");
    expect(decide("e2e/sign-in.spec.ts")).toBe("skip");
    expect(decide("docs/UX.md")).toBe("skip");
    expect(decide(".github/workflows/ci.yml")).toBe("skip");
    expect(decide("tools/ci/x.sh")).toBe("skip");
  });

  it("always builds production and always skips infra and owner branches", () => {
    expect(decide("docs/UX.md", { VERCEL_ENV: "production" })).toBe("build");
    expect(decide("src/app/page.tsx", { VERCEL_GIT_COMMIT_REF: "infra/e2e" })).toBe("skip");
    expect(decide("src/app/page.tsx", { VERCEL_GIT_COMMIT_REF: "owner/roles" })).toBe("skip");
    expect(decide("src/app/page.tsx", { VERCEL_GIT_COMMIT_REF: "wp/10b-core-edit" })).toBe("build");
  });
});
