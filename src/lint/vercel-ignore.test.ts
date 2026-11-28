import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
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
  const bot = { login: "github-actions[bot]" };
  const entry = (context: string, state: string, creator: { login: string } | null = bot) => ({ context, state, ...(creator ? { creator } : {}) });
  const approved = JSON.stringify([entry("ci/other", "failure"), entry("deploy/approved", "success")]);
  const production = (curl: FakeCurl, sha = SHA) => run(repoWith([["src/app/page.tsx"]]), { VERCEL_ENV: "production", VERCEL_GIT_COMMIT_SHA: sha }, curl);

  it("builds only when the newest deploy/approved status is a success created by the Actions bot", () => {
    expect(production({ body: approved })).toBe("build");
    expect(production({ body: JSON.stringify([entry("deploy/approved", "success"), entry("deploy/approved", "failure")]) })).toBe("build");
  });

  it("lets a newer status that is not a success beat an older success, because the list is newest first", () => {
    expect(production({ body: JSON.stringify([entry("deploy/approved", "failure"), entry("deploy/approved", "success")]) })).toBe("skip");
    expect(production({ body: JSON.stringify([entry("deploy/approved", "pending"), entry("deploy/approved", "success")]) })).toBe("skip");
  });

  it.each([
    ["pending", JSON.stringify([entry("deploy/approved", "pending")])],
    ["failure", JSON.stringify([entry("deploy/approved", "failure")])],
    ["the same status from another account", JSON.stringify([entry("deploy/approved", "success", { login: "someone-with-write-access" })])],
    ["a newer success from another account over an older one from the bot", JSON.stringify([entry("deploy/approved", "success", { login: "someone-with-write-access" }), entry("deploy/approved", "success")])],
    ["the same status from a lookalike bot", JSON.stringify([entry("deploy/approved", "success", { login: "github-actions" })])],
    ["the same status with no creator", JSON.stringify([entry("deploy/approved", "success", null)])],
    ["another context", JSON.stringify([entry("deploy/approved-ish", "success"), entry("approved", "success")])],
    ["an empty list", "[]"],
    ["the combined status shape, which has no creators", JSON.stringify({ state: "success", statuses: [{ context: "deploy/approved", state: "success" }] })],
    ["a rate limit answer", JSON.stringify({ message: "API rate limit exceeded", documentation_url: "https://docs.github.com" })],
    ["a list of things that are not statuses", JSON.stringify([null, 3, "deploy/approved"])],
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

  it("does not ask GitHub for a preview: it never needs the approval", () => {
    const bin = mkdtempSync(path.join(tmpdir(), "marking-curl-"));
    const marker = path.join(bin, "asked");
    writeFileSync(path.join(bin, "curl"), `#!/usr/bin/env bash\ntouch "${marker}"\nexit 22\n`, { mode: 0o755 });
    const repo = repoWith([["src/app/page.tsx"]]);
    const result = spawnSync("bash", [SCRIPT], {
      cwd: repo.dir,
      env: { ...process.env, PATH: `${bin}:${process.env.PATH ?? ""}`, VERCEL_ENV: "preview", VERCEL_GIT_COMMIT_REF: "wp/x", VERCEL_GIT_PREVIOUS_SHA: "", VERCEL_GIT_COMMIT_SHA: "0123456789abcdef0123456789abcdef01234567" },
      encoding: "utf8",
    });
    expect(result.status).toBe(0);
    expect(existsSync(marker)).toBe(false);
  });
});

describe("Vercel ignore rule for previews", () => {
  it.each(["src/app/page.tsx", "src/server/services/trip-service.ts", "package.json", "next.config.ts", "public/icon.svg", "tools/ci/vercel-ignore.sh", "docs/UX.md", "src/app/page.test.tsx"])("skips a preview that changes %s", (changed) => {
    expect(decide(changed, { VERCEL_ENV: "preview", VERCEL_GIT_COMMIT_REF: "wp/10b-core-edit" })).toBe("skip");
  });

  it("skips a preview whatever the branch, including a first commit with nothing to compare with", () => {
    expect(run(repoWith([["src/app/page.tsx"]], false), { VERCEL_ENV: "preview", VERCEL_GIT_COMMIT_REF: "main" })).toBe("skip");
    expect(run(repoWith([["src/app/page.tsx"]]), { VERCEL_ENV: "preview", VERCEL_GIT_COMMIT_REF: "" })).toBe("skip");
  });

  it("still builds the app when no deployment environment is named, as when the script is run by hand", () => {
    expect(decide("src/app/page.tsx", { VERCEL_GIT_COMMIT_REF: "wp/10b-core-edit" })).toBe("build");
    expect(decide("src/app/page.tsx", { VERCEL_ENV: "development", VERCEL_GIT_COMMIT_REF: "wp/10b-core-edit" })).toBe("build");
  });
});
