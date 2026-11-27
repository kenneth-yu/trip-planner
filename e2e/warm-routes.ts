import { chromium, type FullConfig, type Page } from "@playwright/test";
import { DECEMBER_TRIP, LISBON_TRIP } from "./trips";

export const WARM_PATHS = ["/", `/trips/${DECEMBER_TRIP}`, `/trips/${DECEMBER_TRIP}/add`, `/trips/${DECEMBER_TRIP}/deadlines`, `/trips/${DECEMBER_TRIP}/inbox`, `/trips/${LISBON_TRIP}`, "/account", `/trips/${DECEMBER_TRIP}/settings/delete`, "/trips/new"];

async function load(page: Page, path: string, expectedPath: string): Promise<void> {
  const response = await page.goto(path, { waitUntil: "load", timeout: 120_000 });
  if (!response || !response.ok()) throw new Error(`Warming ${path} failed with ${response ? response.status() : "no response"}.`);
  const landed = new URL(page.url()).pathname;
  if (landed !== new URL(expectedPath, page.url()).pathname) throw new Error(`Warming ${path} landed on ${landed} instead of ${expectedPath}.`);
}

export default async function warmRoutes(config: FullConfig): Promise<void> {
  const baseURL = config.projects[0]?.use.baseURL;
  if (!baseURL) throw new Error("Set use.baseURL in playwright.config.ts so the routes can be compiled before the tests.");
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({ baseURL });
    await load(page, "/sign-in", "/sign-in");
    await load(page, "/api/dev/sign-in?as=kenny&next=/", "/");
    for (const path of WARM_PATHS) await load(page, path, path);
  } finally {
    await browser.close();
  }
}
