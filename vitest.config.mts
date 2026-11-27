import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  resolve: { alias: { "@": path.resolve(import.meta.dirname, "src") } },
  test: {
    include: ["src/**/*.test.ts"],
    environment: "node",
    setupFiles: ["src/server/db/test-setup.ts", "src/server/db/test-db.ts"],
    env: { TZ: "Pacific/Kiritimati", DATA_ENCRYPTION_KEY: "ZmFrZS10ZXN0LWtleS1ub3QtZm9yLXJlYWwtZGF0YS0=" },
    coverage: {
      provider: "v8",
      include: ["src/**"],
      exclude: ["src/**/*.test.ts", "src/**/*.d.ts", "src/fixtures/**", "src/testing/**", "src/server/testing.ts", "src/server/db/test-setup.ts", "src/server/db/test-db.ts"],
      reporter: ["text", "text-summary", "json-summary"],
      reportsDirectory: "coverage",
      thresholds: { statements: 74, branches: 60, functions: 70, lines: 77 },
    },
  },
});
