import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  resolve: { alias: { "@": path.resolve(import.meta.dirname, "src") } },
  test: {
    include: ["src/**/*.test.ts"],
    exclude: ["**/node_modules/**", ".claude/worktrees/**", ".pipeline/**"],
    environment: "node",
    env: { TZ: "Pacific/Kiritimati", DATA_ENCRYPTION_KEY: "ZmFrZS10ZXN0LWtleS1ub3QtZm9yLXJlYWwtZGF0YS0=" },
  },
});
