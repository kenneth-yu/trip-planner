import type { Locator, Page } from "@playwright/test";
import { expect, test } from "./fixtures";
import { DECEMBER_TRIP } from "./trips";

const PACKED_TRIP = "00000000-0000-4000-8300-000000000103";

const stripOf = (page: Page) => page.getByRole("navigation", { name: "Days of the trip", exact: true });
const chipFor = (page: Page, day: string) => stripOf(page).locator(`a[href$="day=${day}"]`);

async function gapUnderStrip(strip: Locator, target: Locator): Promise<number | null> {
  const stripBox = await strip.boundingBox();
  const targetBox = await target.boundingBox();
  if (!stripBox || !targetBox) return null;
  return targetBox.y - (stripBox.y + stripBox.height);
}

function atPageEnd(page: Page): Promise<boolean> {
  return page.evaluate(() => window.scrollY + window.innerHeight >= document.documentElement.scrollHeight - 2);
}

test("tapping a day keeps the chosen day just under the strip, with its rows in view", async ({ pageSignedInAs }) => {
  const page = await pageSignedInAs("kenny", `/trips/${PACKED_TRIP}`);
  const strip = stripOf(page);
  await expect(strip).toBeVisible();
  await chipFor(page, "2027-03-10").click();
  await expect(page).toHaveURL(/day=2027-03-10/);
  const panel = page.locator("#day-panel");
  await expect
    .poll(async () => {
      const gap = await gapUnderStrip(strip, panel);
      if (gap === null) return false;
      return gap >= 0 && (gap < 24 || (await atPageEnd(page)));
    })
    .toBe(true);
  await expect(strip).toBeInViewport();
  await expect(panel.locator("summary").first()).toContainText("Wed Mar 10");
  await expect(panel.locator("summary").first()).toBeInViewport();
  await expect(panel.locator("a").first()).toBeInViewport();
});

test("the strip stays visible while a day is read, and back and forward keep the day and the place", async ({ pageSignedInAs }) => {
  const page = await pageSignedInAs("kenny", `/trips/${DECEMBER_TRIP}`);
  const strip = stripOf(page);
  const first = await strip.locator("[aria-current=date]").getAttribute("aria-label");
  await chipFor(page, "2026-12-05").scrollIntoViewIfNeeded();
  const before = await page.evaluate(() => window.scrollY);
  await chipFor(page, "2026-12-05").click();
  await expect(page).toHaveURL(/day=2026-12-05/);
  await page.mouse.wheel(0, 400);
  await expect(strip).toBeInViewport();
  await page.goBack();
  await expect(page).not.toHaveURL(/day=2026-12-05/);
  await expect(strip.locator("[aria-current=date]")).toHaveAttribute("aria-label", first ?? "");
  await expect.poll(() => page.evaluate((earlier) => Math.abs(window.scrollY - earlier), before), { message: "back keeps the earlier place" }).toBeLessThanOrEqual(40);
  await page.goForward();
  await expect(page).toHaveURL(/day=2026-12-05/);
  await expect(chipFor(page, "2026-12-05")).toHaveAttribute("aria-current", "date");
});

test("while a long day scrolls, its date stays pinned just under the strip", async ({ pageSignedInAs }) => {
  const page = await pageSignedInAs("kenny", `/trips/${PACKED_TRIP}`);
  const strip = stripOf(page);
  await chipFor(page, "2027-03-09").click();
  await expect(page).toHaveURL(/day=2027-03-09/);
  const header = page.locator("#day-panel summary").first();
  await expect(header).toContainText("Tue Mar 9");
  await page.mouse.wheel(0, 700);
  await expect.poll(async () => Math.abs((await gapUnderStrip(strip, header)) ?? 99) <= 1).toBe(true);
  await expect(strip).toBeInViewport();
  await expect(header).toBeInViewport();
});

for (const [reduced, behavior] of [
  ["reduce", "auto"],
  ["no-preference", "smooth"],
] as const) {
  test(`the scroll after a tap is ${behavior} with reduced motion set to ${reduced}`, async ({ pageSignedInAs }) => {
    const page = await pageSignedInAs("kenny", `/trips/${PACKED_TRIP}`);
    await page.emulateMedia({ reducedMotion: reduced });
    await page.evaluate(() => {
      const original = window.scrollTo.bind(window);
      Reflect.set(window, "scrollBehaviors", []);
      window.scrollTo = (options?: ScrollToOptions | number, y?: number) => {
        if (typeof options === "object") Reflect.get(window, "scrollBehaviors").push(options.behavior);
        if (typeof options === "object") original(options);
        else original(options ?? 0, y ?? 0);
      };
    });
    await chipFor(page, "2027-03-10").click();
    await expect(page).toHaveURL(/day=2027-03-10/);
    await expect.poll(() => page.evaluate(() => Reflect.get(window, "scrollBehaviors"))).toEqual([behavior]);
  });
}

test("on a very short viewport the strip scrolls away so rows keep the room", async ({ pageSignedInAs }) => {
  const page = await pageSignedInAs("kenny", `/trips/${PACKED_TRIP}`);
  await page.setViewportSize({ width: 390, height: 422 });
  const strip = stripOf(page);
  await expect(strip).toBeVisible();
  expect(await strip.evaluate((el) => getComputedStyle(el).position)).toBe("static");
  await chipFor(page, "2027-03-09").click();
  await expect(page).toHaveURL(/day=2027-03-09/);
  const header = page.locator("#day-panel summary").first();
  await expect
    .poll(async () => {
      await page.mouse.wheel(0, 150);
      return header.evaluate((el) => Math.round(el.getBoundingClientRect().top));
    })
    .toBeLessThanOrEqual(1);
  await expect(header).toBeInViewport();
});
