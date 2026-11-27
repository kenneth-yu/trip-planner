import { defineConfig } from "vitest/config";
import { randomBytes } from "node:crypto";
import path from "node:path";

export default defineConfig({
  resolve: { alias: { "@": path.resolve(import.meta.dirname, "src") } },
  test: {
    include: ["src/**/*.test.ts"],
    exclude: ["**/node_modules/**", ".claude/worktrees/**", ".pipeline/**"],
    environment: "node",
    maxWorkers: Number(process.env.VITEST_MAX_WORKERS ?? 4),
    globalSetup: ["src/server/db/test-global-setup.ts"],
    setupFiles: ["src/server/db/test-setup.ts"],
    env: { TZ: "Pacific/Kiritimati", DATA_ENCRYPTION_KEY: randomBytes(32).toString("base64") },
    coverage: {
      provider: "v8",
      include: ["src/**"],
      exclude: ["src/**/*.test.ts", "src/**/*.d.ts", "src/fixtures/**", "src/testing/**", "src/server/testing.ts", "src/server/db/test-setup.ts", "src/server/db/test-global-setup.ts", "src/server/db/test-db.ts"],
      reporter: ["text", "text-summary", "json-summary"],
      reportsDirectory: "coverage",
      thresholds: { statements: 74, branches: 60, functions: 70, lines: 77 },
    },
  },
});
