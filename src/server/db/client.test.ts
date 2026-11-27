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
