import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { realNow } from "@/testing/clock";
import { childEnv, claimSlot, freePort, liveEntries, pidIsAlive, releaseSlot, runLimited, serverArgs, stateDir, TooManyServers } from "../../tools/review-server-lib.mjs";

const scratch = () => mkdtempSync(path.join(os.tmpdir(), "review-state-"));
const entry = (pid: number, port: number) => ({ pid, port, mode: "production", startedAt: 1, expiresAt: 2 });
const alive = (...pids: number[]) => (pid: number) => pids.includes(pid);

async function deadPid(): Promise<number> {
  const child = spawn(process.execPath, ["-e", ""]);
  await new Promise((resolve) => child.on("exit", resolve));
  return child.pid ?? 0;
}

describe("port pick", () => {
  it("returns a free port that can be bound straight away", async () => {
    const port = await freePort();
    expect(port).toBeGreaterThan(1023);
    await new Promise<void>((resolve, reject) => {
      const server = net.createServer();
      server.on("error", reject);
      server.listen(port, "127.0.0.1", () => server.close(() => resolve()));
    });
  });

  it("does not return a port that is in use", async () => {
    const held = net.createServer();
    await new Promise<void>((resolve) => held.listen(0, "127.0.0.1", resolve));
    const address = held.address();
    const taken = typeof address === "object" && address ? address.port : 0;
    const picks = await Promise.all(Array.from({ length: 5 }, () => freePort()));
    expect(picks).not.toContain(taken);
    held.close();
  });
});

describe("the limit of two servers", () => {
  it("lets two servers start and refuses the third", () => {
    const dir = scratch();
    const isAlive = alive(11, 12, 13);
    claimSlot(dir, entry(11, 3001), { isAlive });
    claimSlot(dir, entry(12, 3002), { isAlive });
    expect(() => claimSlot(dir, entry(13, 3003), { isAlive })).toThrow(TooManyServers);
    expect(() => claimSlot(dir, entry(13, 3003), { isAlive })).toThrow(/pid 11 on port 3001, pid 12 on port 3002/);
    expect(readdirSync(dir).sort()).toEqual(["11.json", "12.json"]);
  });

  it("frees a slot when a server releases it", () => {
    const dir = scratch();
    const isAlive = alive(11, 12, 13);
    claimSlot(dir, entry(11, 3001), { isAlive });
    claimSlot(dir, entry(12, 3002), { isAlive });
    releaseSlot(dir, 11);
    claimSlot(dir, entry(13, 3003), { isAlive });
    expect(liveEntries(dir, isAlive).map((e) => e.port).sort()).toEqual([3002, 3003]);
  });

  it("works from any worktree because the default folder is under the temp directory", () => {
    expect(stateDir("")).toBe(path.join(os.tmpdir(), `trip-planner-review-servers-${os.userInfo().uid}`));
    expect(stateDir("/somewhere")).toBe("/somewhere");
  });
});

describe("stale entries", () => {
  it("removes entries whose process is gone and does not count them", async () => {
    const dir = scratch();
    const gone = await deadPid();
    writeFileSync(path.join(dir, `${gone}.json`), JSON.stringify(entry(gone, 3999)));
    expect(pidIsAlive(gone)).toBe(false);
    expect(pidIsAlive(process.pid)).toBe(true);
    claimSlot(dir, entry(process.pid, 3001));
    expect(readdirSync(dir)).toEqual([`${process.pid}.json`]);
  });

  it("lets a new server start when both earlier ones died", () => {
    const dir = scratch();
    claimSlot(dir, entry(21, 3001), { isAlive: alive(21, 22) });
    claimSlot(dir, entry(22, 3002), { isAlive: alive(21, 22) });
    claimSlot(dir, entry(23, 3003), { isAlive: alive(23) });
    expect(readdirSync(dir)).toEqual(["23.json"]);
  });

  it("treats a corrupt entry as stale", () => {
    const dir = scratch();
    writeFileSync(path.join(dir, `${process.pid}.json`), "{not json");
    writeFileSync(path.join(dir, `${process.ppid}.json`), JSON.stringify({ port: "x" }));
    expect(liveEntries(dir)).toEqual([]);
    expect(readdirSync(dir)).toEqual([]);
  });

  it("ignores files that are not entries", () => {
    const dir = scratch();
    writeFileSync(path.join(dir, "notes.txt"), "x");
    expect(liveEntries(dir, alive())).toEqual([]);
    expect(existsSync(path.join(dir, "notes.txt"))).toBe(true);
  });
});

describe("what the server is given", () => {
  it("binds to the loopback address only", () => {
    expect(serverArgs({ dev: false, port: 4321 })).toEqual(["start", "--hostname", "127.0.0.1", "--port", "4321"]);
    expect(serverArgs({ dev: true, port: 4321 })).toEqual(["dev", "--hostname", "127.0.0.1", "--port", "4321"]);
  });

  it("builds the child environment from an allowlist, never passing keys or database urls", () => {
    const source = {
      PATH: "/usr/bin",
      HOME: "/home/x",
      EMAIL_API_KEY: "k",
      EMAIL_FROM: "a@example.test",
      GOOGLE_CLIENT_ID: "g",
      GOOGLE_CLIENT_SECRET: "s",
      ADDRESS_LOOKUP: "openstreetmap",
      ADDRESS_LOOKUP_USER_AGENT: "ua",
      TEST_DATABASE_URL: "postgres://u:p@localhost/x_test",
      DATABASE_URL: "postgres://u:p@db.example.test/prod",
      SESSION_SECRET: "real",
      VERCEL_ENV: "production",
      NODE_ENV: "production",
    };
    const env = childEnv(source, { SESSION_SECRET: "generated" });
    expect(env).toEqual({ PATH: "/usr/bin", HOME: "/home/x", SESSION_SECRET: "generated" });
  });
});

describe("refusing to start", () => {
  const tool = path.join(process.cwd(), "tools", "review-server.mjs");
  const run = (cwd: string, env: Record<string, string>) =>
    spawnSync(process.execPath, [tool], { cwd, env: { NODE_ENV: "development", PATH: process.env.PATH ?? "", REVIEW_SERVER_DIR: scratch(), ...env }, encoding: "utf8", timeout: 20000 });

  it("refuses a DATABASE_URL in the shell without printing it", () => {
    const result = run(scratch(), { DATABASE_URL: "postgres://user:hunter2@db.example.test/prod" });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("DATABASE_URL is set");
    expect(result.stdout + result.stderr).not.toContain("hunter2");
  });

  it.each([".env", ".env.local", ".env.production.local"])("refuses a folder holding %s without reading it", (name) => {
    const cwd = scratch();
    writeFileSync(path.join(cwd, name), "SESSION_SECRET=real-secret-value\n");
    const result = run(cwd, {});
    expect(result.status).toBe(1);
    expect(result.stderr).toContain(name);
    expect(result.stdout + result.stderr).not.toContain("real-secret-value");
  });
});

describe("the time limit", () => {
  it("stops the server and its children when the limit passes", async () => {
    const run = runLimited("bash", ["-c", "sleep 60 & wait"], { cwd: os.tmpdir(), env: process.env, limitMs: 300, killAfterMs: 1000, quiet: true });
    const result = await run.done;
    expect(result.reason).toBe("limit");
  });

  it("reports a normal exit before the limit", async () => {
    const run = runLimited("bash", ["-c", "exit 3"], { cwd: os.tmpdir(), env: process.env, limitMs: 20000, quiet: true });
    expect(await run.done).toEqual({ code: 3, reason: "exited" });
  });

  it("still stops the server on schedule when the wrapper is killed with SIGKILL", async () => {
    const dir = scratch();
    const pidFile = path.join(dir, "server.pid");
    const sleepFile = path.join(dir, "sleep.pid");
    const lib = path.join(process.cwd(), "tools", "review-server-lib.mjs");
    const wrapper = path.join(dir, "wrapper.mjs");
    writeFileSync(
      wrapper,
      `import { runLimited } from ${JSON.stringify(lib)};
const run = runLimited("bash", ["-c", "echo $$ > ${pidFile}; sleep 300 & echo $! > ${sleepFile}; wait"], { cwd: ${JSON.stringify(dir)}, env: process.env, limitMs: 2000, killAfterMs: 1000, quiet: true });
await run.done;
`,
    );
    const wrapperProcess = spawn(process.execPath, [wrapper], { stdio: "ignore" });
    const serverPid = await waitForPid(pidFile);
    expect(pidIsAlive(serverPid)).toBe(true);
    const sleepPid = await waitForPid(sleepFile);
    expect(pidIsAlive(sleepPid)).toBe(true);
    wrapperProcess.kill("SIGKILL");
    await new Promise((resolve) => wrapperProcess.on("exit", resolve));
    expect(pidIsAlive(serverPid)).toBe(true);
    await waitUntil(() => !pidIsAlive(serverPid), 15000);
    expect(pidIsAlive(serverPid)).toBe(false);
    await waitUntil(() => !pidIsAlive(sleepPid), 5000);
    expect(pidIsAlive(sleepPid)).toBe(false);
  }, 30000);
});

async function waitUntil(condition: () => boolean, timeoutMs: number): Promise<void> {
  const deadline = realNow() + timeoutMs;
  while (!condition() && realNow() < deadline) await new Promise((resolve) => setTimeout(resolve, 100));
}

async function waitForPid(file: string): Promise<number> {
  await waitUntil(() => existsSync(file) && readFileSync(file, "utf8").trim().length > 0, 10000);
  return Number(readFileSync(file, "utf8").trim());
}
