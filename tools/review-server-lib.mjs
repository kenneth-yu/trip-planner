import { spawn } from "node:child_process";
import { mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";

export const MAX_SERVERS = 2;
export const LIMIT_MS = 45 * 60 * 1000;
const KILL_AFTER_MS = 15000;

export function stateDir(override = process.env.REVIEW_SERVER_DIR) {
  return override || path.join(os.tmpdir(), "trip-planner-review-servers");
}

export function pidIsAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error instanceof Error && "code" in error && error.code === "EPERM";
  }
}

export function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      server.close(() => resolve(port));
    });
  });
}

function entryFile(dir, pid) {
  return path.join(dir, `${pid}.json`);
}

export function liveEntries(dir, isAlive = pidIsAlive) {
  mkdirSync(dir, { recursive: true });
  const live = [];
  for (const name of readdirSync(dir)) {
    if (!/^\d+\.json$/.test(name)) continue;
    const file = path.join(dir, name);
    const pid = Number(name.slice(0, -5));
    if (isAlive(pid)) {
      live.push({ pid, ...JSON.parse(readFileSync(file, "utf8")) });
    } else {
      rmSync(file, { force: true });
    }
  }
  return live;
}

export class TooManyServers extends Error {
  constructor(entries, max) {
    super(`${entries.length} review servers are already running (the limit is ${max}): ${entries.map((e) => `pid ${e.pid} on port ${e.port}`).join(", ")}. Stop one, or wait for its 45 minute limit.`);
    this.name = "TooManyServers";
  }
}

export function claimSlot(dir, entry, { max = MAX_SERVERS, isAlive = pidIsAlive } = {}) {
  const others = liveEntries(dir, isAlive).filter((e) => e.pid !== entry.pid);
  if (others.length >= max) throw new TooManyServers(others, max);
  writeFileSync(entryFile(dir, entry.pid), JSON.stringify({ port: entry.port, mode: entry.mode, startedAt: entry.startedAt, expiresAt: entry.expiresAt }));
  const after = liveEntries(dir, isAlive);
  if (after.length > max) {
    releaseSlot(dir, entry.pid);
    throw new TooManyServers(after.filter((e) => e.pid !== entry.pid), max);
  }
}

export function releaseSlot(dir, pid) {
  rmSync(entryFile(dir, pid), { force: true });
}

export function runLimited(command, args, { cwd, env, limitMs, killAfterMs = KILL_AFTER_MS, quiet = false }) {
  const guarded = ["--kill-after", `${killAfterMs / 1000}s`, `${limitMs / 1000}s`, command, ...args];
  const child = spawn("timeout", guarded, { cwd, env, stdio: quiet ? "ignore" : "inherit", detached: true });
  const startedAt = Date.now();
  const stop = (signal) => {
    try {
      process.kill(-child.pid, signal);
    } catch (error) {
      if (!(error instanceof Error && "code" in error && error.code === "ESRCH")) throw error;
    }
  };
  const done = new Promise((resolve, reject) => {
    child.on("error", reject);
    child.on("exit", (code) => {
      stop("SIGKILL");
      const limited = code === 124 || code === 137 || (code === null && Date.now() - startedAt >= limitMs);
      resolve({ code, reason: limited ? "limit" : "exited" });
    });
  });
  return { child, done, stop: () => stop("SIGTERM") };
}
