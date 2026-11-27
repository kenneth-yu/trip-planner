import { defineConfig } from "vitest/config";
import { randomBytes } from "node:crypto";
import path from "node:path";

export default defineConfig({
  resolve: { alias: { "@": path.resolve(import.meta.dirname, "src") } },
  test: {
    include: ["perf/**/*.perf.test.ts", "perf/summary.test.ts", "scripts/bundle-budget.test.ts"],
    exclude: ["**/node_modules/**", ".claude/worktrees/**", ".pipeline/**"],
    environment: "node",
    fileParallelism: false,
    maxWorkers: 1,
    testTimeout: 60_000,
    hookTimeout: 180_000,
    globalSetup: ["perf/global-setup.ts"],
    env: { TZ: "Pacific/Kiritimati", DATA_ENCRYPTION_KEY: randomBytes(32).toString("base64") },
  },
});
