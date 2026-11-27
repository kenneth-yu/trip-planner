import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const SCRIPT = path.join(import.meta.dirname, "..", "..", "tools", "ci", "branch-current.sh");
const dirs: string[] = [];

function git(cwd: string, ...args: string[]): string {
  return execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@example.test", "-c", "commit.gpgsign=false", ...args], { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
}

function commit(cwd: string, name: string): string {
  writeFileSync(path.join(cwd, name), name);
  git(cwd, "add", name);
  git(cwd, "commit", "-m", name);
  return git(cwd, "rev-parse", "HEAD");
}

function repo(): string {
  const dir = mkdtempSync(path.join(os.tmpdir(), "branch-current-"));
  dirs.push(dir);
  git(dir, "init", "-b", "main");
  commit(dir, "first");
  return dir;
}

function run(cwd: string, required: string[], maxBehind = 3): { status: number; output: string } {
  const file = path.join(cwd, ".required");
  writeFileSync(file, required.map((sha) => `${sha} tooling`).join("\n") + "\n");
  const result = spawnSync("bash", [SCRIPT, "main", file, String(maxBehind)], { cwd, encoding: "utf8" });
  return { status: result.status ?? -1, output: result.stdout };
}

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe("branch current check", () => {
  it("passes a branch that contains the required commit and is close to main", () => {
    const dir = repo();
    const required = commit(dir, "tooling");
    git(dir, "switch", "-c", "wp/x");
    commit(dir, "work");
    expect(run(dir, [required]).status).toBe(0);
  });

  it("fails a branch cut before the required commit and says to merge main", () => {
    const dir = repo();
    git(dir, "switch", "-c", "wp/old");
    commit(dir, "work");
    git(dir, "switch", "main");
    const required = commit(dir, "tooling");
    git(dir, "switch", "wp/old");
    const result = run(dir, [required]);
    expect(result.status).toBe(1);
    expect(result.output).toContain("git merge origin/main");
    expect(result.output).toContain(required.slice(0, 7));
  });

  it("fails a branch more commits behind main than the limit", () => {
    const dir = repo();
    git(dir, "switch", "-c", "wp/behind");
    git(dir, "switch", "main");
    for (let i = 0; i < 4; i++) commit(dir, `m${i}`);
    git(dir, "switch", "wp/behind");
    const result = run(dir, []);
    expect(result.status).toBe(1);
    expect(result.output).toContain("4 commits behind");
  });

  it("passes a branch exactly at the limit", () => {
    const dir = repo();
    git(dir, "switch", "-c", "wp/edge");
    git(dir, "switch", "main");
    for (let i = 0; i < 3; i++) commit(dir, `m${i}`);
    git(dir, "switch", "wp/edge");
    expect(run(dir, []).status).toBe(0);
  });

  it("refuses a required list that names a commit not on main", () => {
    const dir = repo();
    git(dir, "switch", "-c", "wp/x");
    const stray = commit(dir, "stray");
    const result = run(dir, [stray]);
    expect(result.status).toBe(1);
    expect(result.output).toContain("not part of main");
  });
});
