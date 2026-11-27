import { randomBytes } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { claimSlot, freePort, LIMIT_MS, releaseSlot, runLimited, stateDir, TooManyServers } from "./review-server-lib.mjs";

const args = process.argv.slice(2);
const dev = args.includes("--dev");
const databaseIndex = args.indexOf("--database-url");
const databaseUrl = databaseIndex >= 0 ? args[databaseIndex + 1] : undefined;
const root = process.cwd();
const dir = stateDir();
const startedAt = Date.now();
const expiresAt = startedAt + LIMIT_MS;

function fail(message) {
  process.stderr.write(`${message}\n`);
  process.exit(1);
}

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
const base = { ...process.env, ...secrets, NEXT_TELEMETRY_DISABLED: "1", APP_URL: `http://localhost:${port}`, PGLITE_DIR: path.join(scratch, "db"), DATABASE_URL: databaseUrl ?? "" };
const preview = !dev && databaseUrl;
const serverEnv = dev
  ? { ...base, DEV_SIGN_IN: "1" }
  : preview
    ? { ...base, DEV_SIGN_IN: "1", VERCEL: "1", VERCEL_ENV: "preview", TRUST_PROXY: "0" }
    : { ...base, TRUST_PROXY: "0", APP_URL: `https://localhost:${port}` };

let current = null;
let finished = false;

function cleanup() {
  if (finished) return;
  finished = true;
  if (current) current.stop();
  releaseSlot(dir, process.pid);
  rmSync(scratch, { recursive: true, force: true });
}

for (const signal of ["SIGINT", "SIGTERM"]) {
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
      const response = await fetch(`http://localhost:${port}/sign-in`);
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
  const build = await step(next, ["build"], { ...base, NODE_ENV: "production" });
  if (build.code !== 0) {
    cleanup();
    fail("next build failed.");
  }
}
if (preview) {
  const migrate = await step(tsx, ["scripts/migrate.ts"], serverEnv);
  if (migrate.code !== 0) {
    cleanup();
    fail("The migration failed.");
  }
}
const seed = await step(tsx, ["scripts/seed.ts", ...(preview ? ["--preview-database"] : [])], preview ? serverEnv : { ...base, DEV_SIGN_IN: "1" });
if (seed.code !== 0) {
  cleanup();
  fail("Seeding the demo data failed.");
}

current = runLimited(next, dev ? ["dev", "--port", String(port)] : ["start", "--port", String(port)], { cwd: root, env: serverEnv, limitMs: remaining() });
await waitUntilReady();
const signIn = dev || preview ? "dev sign in is on: /api/dev/sign-in?as=kenny" : "production mode on the embedded database: dev sign in is off by design; use --dev, or --database-url <scratch postgres> for a faithful preview";
process.stdout.write(`Review server: http://localhost:${port} (${dev ? "dev" : "production"}, stops after 45 minutes, ${signIn})\n`);
const result = await current.done;
cleanup();
if (result.reason === "limit") process.stderr.write("The 45 minute limit ended the review server.\n");
process.exit(0);
