import { randomBytes } from "node:crypto";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { childEnv, claimSlot, freePort, LIMIT_MS, releaseSlot, runLimited, serverArgs, stateDir, TooManyServers } from "./review-server-lib.mjs";

const args = process.argv.slice(2);
const dev = args.includes("--dev");
const root = process.cwd();
const dir = stateDir();
const startedAt = Date.now();
const expiresAt = startedAt + LIMIT_MS;

function fail(message) {
  process.stderr.write(`${message}\n`);
  process.exit(1);
}

if (process.env.DATABASE_URL) fail("DATABASE_URL is set in this shell. The review server runs on a scratch embedded database only; unset it first.");
const envFiles = [".env", ".env.local", ".env.development", ".env.development.local", ".env.production", ".env.production.local"].filter((name) => existsSync(path.join(root, name)));
if (envFiles.length > 0) fail(`Next would load ${envFiles.join(", ")} from this folder. Run the review server from a worktree without env files.`);

const port = await freePort();
try {
  claimSlot(dir, { pid: process.pid, port, mode: dev ? "dev" : "production", startedAt, expiresAt });
} catch (error) {
  if (error instanceof TooManyServers) fail(error.message);
  throw error;
}

const scratch = mkdtempSync(path.join(os.tmpdir(), "review-db-"));
const secrets = {
  SESSION_SECRET: randomBytes(32).toString("hex"),
  AUTH_SECRET: randomBytes(32).toString("hex"),
  TOKEN_ENCRYPTION_KEY: randomBytes(32).toString("base64"),
  DATA_ENCRYPTION_KEY: randomBytes(32).toString("base64"),
};
const base = childEnv(process.env, { ...secrets, NEXT_TELEMETRY_DISABLED: "1", APP_URL: `http://localhost:${port}`, PGLITE_DIR: path.join(scratch, "db") });
const serverEnv = dev
  ? { ...base, DEV_SIGN_IN: "1" }
  : { ...base, DEV_SIGN_IN: "1", REVIEW_SERVER: "1", AUTH_TRUST_HOST: "true", TRUST_PROXY: "0" };

let current = null;
let finished = false;

function cleanup() {
  if (finished) return;
  finished = true;
  if (current) current.stop();
  releaseSlot(dir, process.pid);
  rmSync(scratch, { recursive: true, force: true });
}

process.on("exit", cleanup);

for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"]) {
  process.on(signal, () => {
    cleanup();
    process.exit(0);
  });
}

const remaining = () => Math.max(1000, expiresAt - Date.now());

async function step(command, commandArgs, env) {
  current = runLimited(command, commandArgs, { cwd: root, env, limitMs: remaining() });
  const result = await current.done;
  if (result.reason === "limit") {
    cleanup();
    fail("The 45 minute limit ended the review server.");
  }
  return result;
}

async function waitUntilReady() {
  for (let attempt = 0; attempt < 240; attempt += 1) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/sign-in`);
      if (response.status >= 500) {
        cleanup();
        fail(`The server answered ${response.status} on /sign-in, so it is misconfigured. Its output is above.`);
      }
      return;
    } catch (error) {
      if (!(error instanceof TypeError)) throw error;
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
  }
  cleanup();
  fail("The server did not answer within two minutes.");
}

const next = path.join(root, "node_modules", ".bin", "next");
const tsx = path.join(root, "node_modules", ".bin", "tsx");

if (!dev) {
  const build = await step(next, ["build"], base);
  if (build.code !== 0) {
    cleanup();
    fail("next build failed.");
  }
}
const seed = await step(tsx, ["scripts/seed.ts"], base);
if (seed.code !== 0) {
  cleanup();
  fail("Seeding the demo data failed.");
}

current = runLimited(next, serverArgs({ dev, port }), { cwd: root, env: serverEnv, limitMs: remaining() });
await waitUntilReady();
process.stdout.write(`Review server: http://localhost:${port} (${dev ? "dev" : "production build as a local preview"}, stops after 45 minutes; sign in with /api/dev/sign-in?as=kenny)\n`);
const finalResult = await current.done;
cleanup();
if (finalResult.reason === "limit") process.stderr.write("The 45 minute limit ended the review server.\n");
process.exit(0);
