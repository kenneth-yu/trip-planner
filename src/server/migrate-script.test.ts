import { spawnSync } from "node:child_process";
import path from "node:path";
import { describe, expect, it } from "vitest";

const tsx = path.join(process.cwd(), "node_modules", ".bin", "tsx");
const remote = "postgres://user:hunter2@ep-cool.neon.test/trips";
const SCRUBBED = new Set(["NODE_ENV", "VERCEL_ENV", "DATABASE_URL"]);
const unreachable ="postgres://user:hunter2@127.0.0.1:1/trips";

function run(script: string, env: Record<string, string>, args: string[] = []) {
  const inherited = Object.fromEntries(Object.entries(process.env).filter(([name]) => !SCRUBBED.has(name)));
  const result = spawnSync(tsx, [script, ...args], { env: { ...inherited, NODE_ENV: "development", ...env }, encoding: "utf8" });
  return { status: result.status, output: result.stdout + result.stderr };
}

function expectNoLeak(output: string) {
  for (const leak of ["hunter2", "127.0.0.1", "neon.test", "Failed query", "select "]) expect(output).not.toContain(leak);
}

describe("scripts/migrate.ts", { timeout: 60000 }, () => {
  it("refuses with a setup message when there is no database url", () => {
    const result = run("scripts/migrate.ts", {});
    expect(result.status).toBe(1);
    expect(result.output).toContain("DATABASE_URL is not set");
  });

  it("prints a fixed failure when it cannot connect, never the address or password", () => {
    const result = run("scripts/migrate.ts", { DATABASE_URL: unreachable });
    expect(result.status).toBe(1);
    expect(result.output).toContain("Migration failed");
    expectNoLeak(result.output);
  });
});

describe("scripts/seed.ts", { timeout: 60000 }, () => {
  it("refuses a remote database with a one line message and no address", () => {
    const result = run("scripts/seed.ts", { DATABASE_URL: remote });
    expect(result.status).toBe(1);
    expect(result.output).toContain("remote database");
    expectNoLeak(result.output);
  });

  it("prints a fixed failure when the preview database is unreachable", () => {
    const result = run("scripts/seed.ts", { DATABASE_URL: unreachable, DATA_ENCRYPTION_KEY: Buffer.alloc(32, 5).toString("base64") });
    expect(result.status).toBe(1);
    expect(result.output).toContain("Seeding failed");
    expectNoLeak(result.output);
  });
});

describe("scripts/import-trip.ts", { timeout: 60000 }, () => {
  it("needs an owner email", () => {
    expect(run("scripts/import-trip.ts", {}).status).toBe(1);
  });

  it("refuses a remote database without the flag, before connecting", () => {
    const result = run("scripts/import-trip.ts", { DATABASE_URL: remote }, ["--owner-email", "me@mail.test"]);
    expect(result.status).toBe(1);
    expect(result.output).toContain("--allow-production");
    expectNoLeak(result.output);
    expect(result.output).not.toContain("me@mail.test");
  });

  it("prints a fixed failure when the database is unreachable", () => {
    const result = run("scripts/import-trip.ts", { DATABASE_URL: unreachable, DATA_ENCRYPTION_KEY: Buffer.alloc(32, 5).toString("base64") }, ["--owner-email", "me@mail.test"]);
    expect(result.status).toBe(1);
    expect(result.output).toContain("Import failed");
    expectNoLeak(result.output);
    expect(result.output).not.toContain("me@mail.test");
  });
});
