import { randomBytes } from "node:crypto";
import path from "node:path";
import { defineConfig, devices } from "@playwright/test";

const port = Number(process.env.E2E_PORT ?? 3190);
const baseURL = `http://localhost:${port}`;
const production = process.env.E2E_PRODUCTION_BUILD === "1";
if (production && !process.env.E2E_DATABASE_URL) {
  throw new Error("E2E_PRODUCTION_BUILD=1 needs E2E_DATABASE_URL, the Postgres database the production build runs against.");
}
const dbDir = path.join(import.meta.dirname, ".pipeline", "scratch", "e2e", "db");

export default defineConfig({
  testDir: "e2e",
  globalSetup: "./e2e/warm-routes.ts",
  outputDir: "test-results",
  fullyParallel: false,
  workers: 1,
  forbidOnly: Boolean(process.env.CI),
  retries: 0,
  reporter: process.env.CI ? [["list"], ["html", { open: "never", outputFolder: "playwright-report" }]] : [["list"]],
  use: { baseURL, trace: "retain-on-failure" },
  projects: [{ name: "phone", use: { ...devices["Desktop Chrome"], viewport: { width: 390, height: 844 } } }],
  webServer: {
    command: production
      ? `npx tsx scripts/migrate.ts && npx tsx scripts/seed.ts --preview-database && npx next start --port ${port}`
      : `rm -rf "$PGLITE_DIR" && npx tsx scripts/seed.ts && npx next dev --port ${port}`,
    url: `${baseURL}/sign-in`,
    reuseExistingServer: false,
    timeout: 180_000,
    stdout: "pipe",
    env: {
      PGLITE_DIR: dbDir,
      DATABASE_URL: production ? (process.env.E2E_DATABASE_URL ?? "") : "",
      ...(production ? { VERCEL: "1", VERCEL_ENV: "preview", TRUST_PROXY: "0" } : {}),
      DEV_SIGN_IN: "1",
      GOOGLE_IMPORT_FAKE: "1",
      EMAIL_API_KEY: "",
      EMAIL_FROM: "",
      GOOGLE_CLIENT_ID: "",
      GOOGLE_CLIENT_SECRET: "",
      ADDRESS_LOOKUP: "",
      ADDRESS_LOOKUP_USER_AGENT: "",
      APP_URL: baseURL,
      NEXT_TELEMETRY_DISABLED: "1",
      SESSION_SECRET: process.env.E2E_SESSION_SECRET ?? randomBytes(32).toString("hex"),
      AUTH_SECRET: process.env.E2E_AUTH_SECRET ?? randomBytes(32).toString("hex"),
      TOKEN_ENCRYPTION_KEY: process.env.E2E_TOKEN_ENCRYPTION_KEY ?? randomBytes(32).toString("base64"),
      DATA_ENCRYPTION_KEY: process.env.E2E_DATA_ENCRYPTION_KEY ?? randomBytes(32).toString("base64"),
    },
  },
});
