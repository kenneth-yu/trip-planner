import { execFile, spawn, type ChildProcess } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { z } from "zod";
import { sessionCookieName } from "../src/server/auth/config";

const run = promisify(execFile);
const Prepared = z.object({ token: z.string().min(1), session: z.string().min(1) });
const BIN = path.join("node_modules", ".bin");

export interface PerfServer {
  baseUrl: string;
  token: string;
  sessionCookie: string;
  stop: () => Promise<void>;
}

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const probe = createServer();
    probe.once("error", reject);
    probe.listen(0, () => {
      const address = probe.address();
      probe.close(() => (address && typeof address === "object" ? resolve(address.port) : reject(new Error("No port was assigned."))));
    });
  });
}

async function waitUntilReady(url: string, child: ChildProcess): Promise<void> {
  const deadline = Date.now() + 120_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`next start exited with code ${child.exitCode} before it was ready.`);
    try {
      const res = await fetch(url);
      if (res.ok) return;
    } catch (e) {
      if (!(e instanceof TypeError)) throw e;
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(`The built app did not answer ${url} within 120 seconds.`);
}

export async function startPerfServer(): Promise<PerfServer> {
  if (!existsSync(path.join(".next", "BUILD_ID"))) throw new Error("There is no production build. Run npx next build before the performance suite.");
  const dir = await mkdtemp(path.join(tmpdir(), "trip-planner-perf-"));
  const port = Number(process.env.PERF_PORT) || (await freePort());
  const baseUrl = `http://127.0.0.1:${port}`;
  const env = {
    ...process.env,
    PGLITE_DIR: path.join(dir, "db"),
    DATABASE_URL: "",
    REVIEW_SERVER: "1",
    DEV_SIGN_IN: "",
    TRUST_PROXY: "0",
    EMAIL_API_KEY: "",
    EMAIL_FROM: "",
    GOOGLE_CLIENT_ID: "",
    GOOGLE_CLIENT_SECRET: "",
    ADDRESS_LOOKUP: "",
    ADDRESS_LOOKUP_USER_AGENT: "",
    APP_URL: "https://perf.example.test",
    NEXT_TELEMETRY_DISABLED: "1",
    SESSION_SECRET: randomBytes(32).toString("hex"),
    AUTH_SECRET: randomBytes(32).toString("hex"),
    TOKEN_ENCRYPTION_KEY: randomBytes(32).toString("base64"),
    DATA_ENCRYPTION_KEY: randomBytes(32).toString("base64"),
  };
  const prepared = await run(path.join(BIN, "tsx"), ["perf/prepare-db.ts"], { env });
  const { token, session } = Prepared.parse(JSON.parse(prepared.stdout.trim()));
  const sessionCookie = `${sessionCookieName({ NODE_ENV: "production" })}=${session}`;
  const child = spawn(path.join(BIN, "next"), ["start", "--hostname", "127.0.0.1", "--port", String(port)], { env, stdio: "ignore" });
  const stop = async () => {
    child.kill("SIGTERM");
    await rm(dir, { recursive: true, force: true });
  };
  try {
    await waitUntilReady(`${baseUrl}/sign-in`, child);
  } catch (e) {
    await stop();
    throw e;
  }
  return { baseUrl, token, sessionCookie, stop };
}
