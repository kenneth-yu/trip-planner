import { randomBytes } from "node:crypto";
import { tmpdir } from "node:os";
import path from "node:path";
import { defineConfig, devices } from "@playwright/test";

const port = 3190;
const baseURL = `http://localhost:${port}`;
const dbDir = process.env.CI ? path.join(tmpdir(), "trip-planner-e2e-db") : "/home/aorkennykiller/code/trip-planner/.pipeline/scratch/e2e/db";

export default defineConfig({
  testDir: "e2e",
  outputDir: "test-results",
  fullyParallel: false,
  workers: 1,
  forbidOnly: Boolean(process.env.CI),
  retries: 0,
  reporter: process.env.CI ? [["list"], ["html", { open: "never", outputFolder: "playwright-report" }]] : [["list"]],
  use: { baseURL, trace: "retain-on-failure" },
  projects: [{ name: "phone", use: { ...devices["Desktop Chrome"], viewport: { width: 390, height: 844 } } }],
  webServer: {
    command: `rm -rf "$PGLITE_DIR" && npx tsx scripts/seed.ts && npx next dev --port ${port}`,
    url: `${baseURL}/sign-in`,
    reuseExistingServer: false,
    timeout: 180_000,
    stdout: "pipe",
    env: {
      PGLITE_DIR: dbDir,
      DATABASE_URL: "",
      DEV_SIGN_IN: "1",
      APP_URL: baseURL,
      NEXT_TELEMETRY_DISABLED: "1",
      SESSION_SECRET: randomBytes(32).toString("hex"),
      AUTH_SECRET: randomBytes(32).toString("hex"),
      TOKEN_ENCRYPTION_KEY: randomBytes(32).toString("base64"),
      DATA_ENCRYPTION_KEY: randomBytes(32).toString("base64"),
    },
  },
});
