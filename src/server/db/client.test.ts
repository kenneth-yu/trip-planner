import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { present } from "@/testing/present";
import { getDb } from "./client";

afterEach(() => {
  vi.unstubAllEnvs();
  globalThis.__tripDb = undefined;
});

const EMBEDDED_INITDB_MS = 15_000;

describe("migrations at open", () => {
  it("does not migrate a Postgres database and keeps the pool small", async () => {
    const poolOptions: unknown[] = [];
    const migrate = vi.fn();
    vi.resetModules();
    vi.doMock("pg", () => ({
      Pool: class {
        constructor(options: unknown) {
          poolOptions.push(options);
        }
      },
    }));
    vi.doMock("drizzle-orm/node-postgres/migrator", () => ({ migrate }));
    const { createPostgresDb } = await import("./client");
    await createPostgresDb("postgres://user:pw@db.example.test/trips");
    expect(migrate).not.toHaveBeenCalled();
    expect(poolOptions).toEqual([{ connectionString: "postgres://user:pw@db.example.test/trips", max: 3, idleTimeoutMillis: 10000 }]);
    vi.doUnmock("pg");
    vi.doUnmock("drizzle-orm/node-postgres/migrator");
  });

  it("migrates the embedded database in process", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "trip-db-"));
    vi.resetModules();
    const { createPgliteDb } = await import("./client");
    const { users } = await import("./schema");
    const db = await createPgliteDb(dir);
    await expect(db.select().from(users)).resolves.toEqual([]);
    await rm(dir, { recursive: true, force: true });
  }, EMBEDDED_INITDB_MS);

  it("refuses to open a Vercel deployment without a database url", async () => {
    vi.stubEnv("VERCEL_ENV", "preview");
    vi.stubEnv("DATABASE_URL", "");
    await expect(getDb()).rejects.toThrow(/DATABASE_URL/);
  });
});

describe("opening the database", () => {
  it("fails at once with the setup message when the data encryption key is missing", async () => {
    vi.stubEnv("DATA_ENCRYPTION_KEY", "");
    vi.stubEnv("DATABASE_URL", "");
    await expect(getDb()).rejects.toThrow(/DATA_ENCRYPTION_KEY is not set. Generate one with: openssl rand -base64 32/);
  });

  it("opens on the next call after a failed first open, instead of keeping the failure", async () => {
    const key = present(process.env.DATA_ENCRYPTION_KEY);
    const dir = await mkdtemp(path.join(tmpdir(), "trip-db-"));
    vi.stubEnv("DATABASE_URL", "");
    vi.stubEnv("PGLITE_DIR", dir);
    vi.stubEnv("DATA_ENCRYPTION_KEY", "");
    await expect(getDb()).rejects.toThrow(/DATA_ENCRYPTION_KEY is not set/);
    vi.stubEnv("DATA_ENCRYPTION_KEY", key);
    await expect(getDb()).resolves.toBeDefined();
    await rm(dir, { recursive: true, force: true });
  });
});
