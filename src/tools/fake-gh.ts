import { execFileSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

export interface Route {
  match: string;
  out?: string;
  fail?: string;
  failBody?: string;
  failTimes?: number;
}

const SCRIPT = `#!/usr/bin/env node
const fs = require("node:fs");
const fixture = JSON.parse(fs.readFileSync(process.env.FAKE_GH_FIXTURE, "utf8"));
const line = process.argv.slice(2).join(" ").replace(/\\n/g, " ");
const before = fs.readFileSync(fixture.log, "utf8").split("\\n");
fs.appendFileSync(fixture.log, line + "\\n");
const route = fixture.routes.find((r) => line.includes(r.match));
if (!route) {
  process.stderr.write("no route for: " + line + "\\n");
  process.exit(1);
}
const earlier = route ? before.filter((l) => l.includes(route.match)).length : 0;
if (route && route.fail && (route.failTimes === undefined || earlier < route.failTimes)) {
  if (route.failBody) process.stdout.write(route.failBody);
  process.stderr.write(route.fail + "\\n");
  process.exit(1);
}
process.stdout.write(route.out ?? "");
`;

export interface Harness {
  dir: string;
  cwd: string;
  run: (command: string, args: string[], extraEnv?: Record<string, string>) => { status: number | null; stdout: string; stderr: string };
  calls: () => string[];
  setRoutes: (routes: Route[]) => void;
}

function git(cwd: string, ...args: string[]): string {
  return execFileSync("git", ["-c", "user.email=t@example.invalid", "-c", "user.name=T", "-c", "commit.gpgsign=false", ...args], { cwd, encoding: "utf8", stdio: "pipe" }).trim();
}

export function makeHarness(options: { pullRefs?: number[] } = {}): Harness {
  const dir = mkdtempSync(path.join(os.tmpdir(), "fake-gh-"));
  const bin = path.join(dir, "bin");
  mkdirSync(bin);
  writeFileSync(path.join(bin, "gh"), SCRIPT);
  chmodSync(path.join(bin, "gh"), 0o755);
  const origin = path.join(dir, "origin.git");
  const cwd = path.join(dir, "clone");
  git(dir, "init", "-q", "--bare", "-b", "main", origin);
  git(dir, "clone", "-q", origin, cwd);
  writeFileSync(path.join(cwd, "README.md"), "x\n");
  git(cwd, "add", "-A");
  git(cwd, "commit", "-qm", "start");
  git(cwd, "branch", "-M", "main");
  git(cwd, "push", "-q", "origin", "main");
  for (const number of options.pullRefs ?? []) git(cwd, "push", "-q", "origin", `main:refs/pull/${number}/head`);
  const log = path.join(dir, "calls.log");
  writeFileSync(log, "");
  const fixturePath = path.join(dir, "fixture.json");
  const setRoutes = (routes: Route[]) => writeFileSync(fixturePath, JSON.stringify({ log, routes }));
  setRoutes([]);
  return {
    dir,
    cwd,
    setRoutes,
    calls: () => readFileSync(log, "utf8").split("\n").filter((l) => l.length > 0),
    run: (command, args, extraEnv = {}) => {
      try {
        const stdout = execFileSync(command, args, {
          cwd,
          encoding: "utf8",
          stdio: "pipe",
          env: { NODE_ENV: "development", PATH: `${bin}:${process.env.PATH ?? ""}`, HOME: dir, FAKE_GH_FIXTURE: fixturePath, ...extraEnv },
          timeout: 60000,
        });
        return { status: 0, stdout, stderr: "" };
      } catch (error) {
        if (error && typeof error === "object" && "status" in error && "stdout" in error && "stderr" in error) {
          return { status: typeof error.status === "number" ? error.status : null, stdout: String(error.stdout), stderr: String(error.stderr) };
        }
        throw error;
      }
    },
  };
}
