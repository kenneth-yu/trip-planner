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
  await page.goto(`/trips/${DECEMBER_TRIP}`).catch(() => undefined);
  await expect(page.getByRole("heading", { level: 1, name: "You are offline." })).toBeVisible();
  await expect(page.getByText("Your trip will show again when you have a connection.")).toBeVisible();
  await expect(page.getByText("If you saved screenshots of your bookings, they are in your photos.")).toBeVisible();
  await expect(page.getByText("Asia, December 2026")).toHaveCount(0);
  await context.setOffline(false);
  await page.getByRole("button", { name: "Try again" }).click();
  await expect(page.getByRole("heading", { name: "Asia, December 2026" })).toBeVisible();
});
