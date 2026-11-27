import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "/home/aorkennykiller/code/trip-planner/.claude/worktrees/agent-a67b970896c404b7c/e2e",
  workers: 1,
  retries: 0,
  reporter: [["list"]],
  use: { baseURL: "http://localhost:43619" },
  projects: [{ name: "phone", use: { ...devices["Desktop Chrome"], viewport: { width: 390, height: 844 } } }],
});
