import { afterEach, describe, expect, it, vi } from "vitest";
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
});
