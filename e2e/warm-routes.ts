import { chromium, type FullConfig } from "@playwright/test";
import { DECEMBER_TRIP, LISBON_TRIP } from "./trips";

export const WARM_PATHS = ["/sign-in", "/", `/trips/${DECEMBER_TRIP}`, `/trips/${DECEMBER_TRIP}/add`, `/trips/${DECEMBER_TRIP}/deadlines`, `/trips/${DECEMBER_TRIP}/inbox`, `/trips/${LISBON_TRIP}`];

export default async function warmRoutes(config: FullConfig): Promise<void> {
  const baseURL = config.projects[0]?.use.baseURL;
  if (!baseURL) throw new Error("Set use.baseURL in playwright.config.ts so the routes can be compiled before the tests.");
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({ baseURL });
    await page.goto("/api/dev/sign-in?as=kenny&next=/");
    for (const path of WARM_PATHS) {
      const response = await page.goto(path, { waitUntil: "load", timeout: 120_000 });
      if (!response || response.status() >= 500) throw new Error(`Warming ${path} failed with ${response ? response.status() : "no response"}.`);
    }
  } finally {
    await browser.close();
  }
}
