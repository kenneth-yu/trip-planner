import { spawnSync } from "node:child_process";
import path from "node:path";
import { describe, expect, it } from "vitest";

const tsx = path.join(process.cwd(), "node_modules", ".bin", "tsx");

describe("scripts/migrate.ts", () => {
  it("refuses with a setup message when there is no database url", () => {
    const result = spawnSync(tsx, ["scripts/migrate.ts"], { env: { ...process.env, DATABASE_URL: "" }, encoding: "utf8" });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("DATABASE_URL is not set");
  });

  it("never prints the database url when it cannot connect", () => {
    const url = "postgres://user:hunter2@127.0.0.1:1/trips";
    const result = spawnSync(tsx, ["scripts/migrate.ts"], { env: { ...process.env, DATABASE_URL: url }, encoding: "utf8" });
    expect(result.status).not.toBe(0);
    expect(result.stdout + result.stderr).not.toContain("hunter2");
  });
});
