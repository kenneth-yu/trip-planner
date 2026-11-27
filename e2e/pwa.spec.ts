import { expect, test } from "./fixtures";
import { DECEMBER_TRIP } from "./trips";

test("the service worker registers under the CSP and caches only the offline page and icons", async ({ page, signIn }) => {
  const violations: string[] = [];
  page.on("console", (message) => {
    if (message.text().includes("Content Security Policy")) violations.push(message.text());
  });
  await signIn("kenny");
  await page.evaluate(() => navigator.serviceWorker.ready.then(() => undefined));
  const cached = await page.evaluate(async () => {
    const names = await caches.keys();
    const urls: string[] = [];
    for (const name of names) {
      for (const request of await (await caches.open(name)).keys()) urls.push(new URL(request.url).pathname);
    }
    return urls.sort();
  });
  expect(cached).toEqual(["/apple-touch-icon.png", "/icon-192.png", "/icon-512.png", "/icon-maskable-512.png", "/icon.svg", "/offline"]);
  expect(violations).toEqual([]);
});

test("a navigation with no network shows the offline page and Try again reloads", async ({ page, context, signIn }) => {
  await signIn("kenny");
  await page.evaluate(() => navigator.serviceWorker.ready.then(() => undefined));
  await page.reload();
  await context.setOffline(true);
  await page.goto(`/trips/${DECEMBER_TRIP}`);
  await expect(page.getByRole("heading", { level: 1, name: "Your trip can't load right now." })).toBeVisible();
  await expect(page.getByText("You may be offline, or the connection is too slow. Try again in a moment.")).toBeVisible();
  await expect(page.getByText("If you saved screenshots of your bookings, they are in your photos.")).toBeVisible();
  await expect(page.getByText("Asia, December 2026")).toHaveCount(0);
  await context.setOffline(false);
  await page.getByRole("button", { name: "Try again" }).click();
  await expect(page.getByRole("heading", { name: "Asia, December 2026" })).toBeVisible();
});

test("the offline page is the same bytes for an anonymous visitor and a signed in traveler, nonce aside", async ({ page, request, signIn }) => {
  const nonceOf = (html: string) => /<script nonce="([^"]+)"/.exec(html)?.[1] ?? "";
  const anonymous = await (await request.get("/offline")).text();
  await signIn("kenny");
  const signedIn = await (await page.request.get("/offline")).text();
  expect(nonceOf(anonymous)).not.toBe("");
  expect(signedIn.replace(nonceOf(signedIn), nonceOf(anonymous))).toBe(anonymous);
  expect(anonymous).not.toContain("/_next/");
});
