import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

const SCRIPT = path.join(import.meta.dirname, "..", "..", "tools", "ci", "vercel-ignore.sh");

interface Repo {
  dir: string;
  shas: string[];
}

function repoWith(commits: string[][], withStart = true): Repo {
  const dir = mkdtempSync(path.join(tmpdir(), "vercel-ignore-"));
  const git = (...args: string[]) => execFileSync("git", args, { cwd: dir, stdio: "pipe", encoding: "utf8" }).trim();
  git("init", "-q");
  git("config", "user.email", "test@example.invalid");
  git("config", "user.name", "Test");
  const shas: string[] = [];
  const all = withStart ? [["README.md"], ...commits] : commits;
  for (const [index, changes] of all.entries()) {
    for (const change of changes) {
      const target = path.join(dir, change.replace(/^-/, ""));
      if (change.startsWith("-")) rmSync(target);
      else {
        mkdirSync(path.dirname(target), { recursive: true });
        writeFileSync(target, `change ${index}\n`);
      }
    }
    git("add", "-A");
    git("commit", "-qm", `commit ${index}`);
    shas.push(git("rev-parse", "HEAD"));
  }
  return { dir, shas };
}

interface FakeCurl {
  body?: string;
  exitCode?: number;
}

function fakeCurlDirectory(curl: FakeCurl): string {
  const bin = mkdtempSync(path.join(tmpdir(), "fake-curl-"));
  const script = curl.exitCode ? `#!/usr/bin/env bash\nexit ${curl.exitCode}\n` : `#!/usr/bin/env bash\ncat <<'JSON'\n${curl.body ?? ""}\nJSON\n`;
  writeFileSync(path.join(bin, "curl"), script, { mode: 0o755 });
  return bin;
}

function run(repo: Repo, env: Record<string, string> = {}, curl?: FakeCurl): "build" | "skip" {
  const path_ = curl ? `${fakeCurlDirectory(curl)}:${process.env.PATH ?? ""}` : (process.env.PATH ?? "");
  const result = spawnSync("bash", [SCRIPT], {
    cwd: repo.dir,
    env: { ...process.env, PATH: path_, VERCEL_ENV: "", VERCEL_GIT_COMMIT_REF: "", VERCEL_GIT_PREVIOUS_SHA: "", VERCEL_GIT_COMMIT_SHA: "", ...env },
    encoding: "utf8",
  });
  if (result.status === 0) return "skip";
  if (result.status === 1) return "build";
  throw new Error(`vercel-ignore.sh exited ${result.status}: ${result.stderr}`);
}

function decide(changed: string, env: Record<string, string> = {}): "build" | "skip" {
  return run(repoWith([[changed]]), env);
}

describe("Vercel ignore rule", () => {
  it.each([
    "src/app/page.tsx",
    "src/server/services/trip-service.ts",
    "src/proxy.ts",
    "src/instrumentation.ts",
    "src/app/globals.css",
    "src/app/trips/trip.module.css",
    "public/icon.svg",
    "package.json",
    "package-lock.json",
    "next.config.ts",
    "vercel.json",
    "tsconfig.json",
    "scripts/migrate.ts",
    "drizzle/0008_x.sql",
    "tools/ci/vercel-ignore.sh",
    "a-new-top-level-file.ts",
  ])("builds a commit that changes only %s", (file) => {
    expect(decide(file)).toBe("build");
  });

  it.each([
    "src/server/auth/auth.test.ts",
    "src/app/page.test.tsx",
    "src/foo.test.ts",
    "e2e/sign-in.spec.ts",
    "src/testing/present.ts",
    "src/lint/vercel-ignore.test.ts",
    "docs/UX.md",
    "README.md",
    ".github/workflows/ci.yml",
    ".claude/agents/qa.md",
    ".pipeline/status.md",
    "tools/ci/other.sh",
    "tools/merge-gate.mjs",
  ])("skips a commit that changes only %s", (file) => {
    expect(decide(file)).toBe("skip");
  });

  it("builds a commit that mixes a test file with an app file", () => {
    expect(run(repoWith([["src/app/q.test.ts", "src/app/page.tsx"]]))).toBe("build");
  });

  it("builds a commit that deletes an app file and skips one that deletes a test", () => {
    expect(run(repoWith([["src/app/page.tsx"], ["-src/app/page.tsx"]]))).toBe("build");
    expect(run(repoWith([["src/app/a.test.ts"], ["-src/app/a.test.ts"]]))).toBe("skip");
  });

  it("builds a two commit push whose head commit is test only, using the previous sha", () => {
    const repo = repoWith([["src/app/page.tsx"], ["src/app/q.test.ts"]]);
    expect(run(repo)).toBe("skip");
    expect(run(repo, { VERCEL_GIT_PREVIOUS_SHA: repo.shas[0] })).toBe("build");
  });

  it("skips a two commit push that changes only tests and docs", () => {
    const repo = repoWith([["src/app/q.test.ts"], ["docs/UX.md"]]);
    expect(run(repo, { VERCEL_GIT_PREVIOUS_SHA: repo.shas[0] })).toBe("skip");
  });

  it("falls back to the parent commit when the previous sha is not in the clone", () => {
    const repo = repoWith([["src/app/page.tsx"]]);
    expect(run(repo, { VERCEL_GIT_PREVIOUS_SHA: "0123456789abcdef0123456789abcdef01234567" })).toBe("build");
    const docs = repoWith([["docs/UX.md"]]);
    expect(run(docs, { VERCEL_GIT_PREVIOUS_SHA: "0123456789abcdef0123456789abcdef01234567" })).toBe("skip");
  });

  it("builds when there is no earlier commit to compare with", () => {
    expect(run(repoWith([["docs/UX.md"]], false))).toBe("build");
  });

  it("never builds production from a merge, and skips infra and owner branches whatever they change", () => {
    expect(decide("src/app/page.tsx", { VERCEL_ENV: "production" })).toBe("skip");
    expect(decide("docs/UX.md", { VERCEL_ENV: "production" })).toBe("skip");
    expect(decide("src/app/page.tsx", { VERCEL_GIT_COMMIT_REF: "infra/e2e" })).toBe("skip");
    expect(decide("src/app/page.tsx", { VERCEL_GIT_COMMIT_REF: "owner/roles" })).toBe("skip");
    expect(decide("src/app/page.tsx", { VERCEL_GIT_COMMIT_REF: "wp/10b-core-edit" })).toBe("build");
    expect(decide("docs/UX.md", { VERCEL_GIT_COMMIT_REF: "wp/10b-core-edit" })).toBe("skip");
  });
});

describe("Vercel ignore rule for production", () => {
  const SHA = "0123456789abcdef0123456789abcdef01234567";
  const approved = JSON.stringify({ state: "success", statuses: [{ context: "ci/other", state: "failure" }, { context: "deploy/approved", state: "success" }] });
  const production = (curl: FakeCurl, sha = SHA) => run(repoWith([["src/app/page.tsx"]]), { VERCEL_ENV: "production", VERCEL_GIT_COMMIT_SHA: sha }, curl);

  it("builds only when the commit carries deploy/approved set to success", () => {
    expect(production({ body: approved })).toBe("build");
  });

  it.each([
    ["pending", JSON.stringify({ statuses: [{ context: "deploy/approved", state: "pending" }] })],
    ["failure", JSON.stringify({ statuses: [{ context: "deploy/approved", state: "failure" }] })],
    ["another context", JSON.stringify({ statuses: [{ context: "deploy/approved-ish", state: "success" }, { context: "approved", state: "success" }] })],
    ["no statuses", JSON.stringify({ state: "pending", statuses: [] })],
    ["a rate limit answer", JSON.stringify({ message: "API rate limit exceeded", documentation_url: "https://docs.github.com" })],
    ["a statuses field that is not a list", JSON.stringify({ statuses: "deploy/approved success" })],
    ["a page that is not JSON", "<html>Bad gateway</html>"],
    ["an empty answer", ""],
  ])("skips on %s", (_name, body) => {
    expect(production({ body })).toBe("skip");
  });

  it("skips when the API cannot be reached or answers an error", () => {
    expect(production({ exitCode: 22 })).toBe("skip");
    expect(production({ exitCode: 28 })).toBe("skip");
  });

  it.each(["", "abc", "0123456789ABCDEF0123456789ABCDEF01234567", `${SHA}0`, `${SHA.slice(0, 39)}g`, "../../etc/passwd"])("skips without asking GitHub when the commit id is %j", (sha) => {
    expect(production({ body: approved }, sha)).toBe("skip");
  });

  it("applies to production only: a preview never needs the approval", () => {
    expect(run(repoWith([["src/app/page.tsx"]]), { VERCEL_ENV: "preview", VERCEL_GIT_COMMIT_REF: "wp/x" }, { exitCode: 22 })).toBe("build");
  });
});
