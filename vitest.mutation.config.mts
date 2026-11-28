import { defineConfig } from "vitest/config";
import { randomBytes } from "node:crypto";
import path from "node:path";

export default defineConfig({
  resolve: { alias: { "@": path.resolve(import.meta.dirname, "src") } },
  test: {
    include: ["src/domain/**/*.test.ts"],
    exclude: ["**/node_modules/**", ".claude/worktrees/**", ".pipeline/**"],
    environment: "node",
    maxWorkers: Number(process.env.VITEST_MAX_WORKERS ?? 2),
    env: { TZ: "Pacific/Kiritimati", DATA_ENCRYPTION_KEY: randomBytes(32).toString("base64") },
  },
});
