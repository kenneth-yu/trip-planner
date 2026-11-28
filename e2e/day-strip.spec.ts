import type { Locator, Page } from "@playwright/test";
import { expect, test } from "./fixtures";
import { DECEMBER_TRIP } from "./trips";

const PACKED_TRIP = "00000000-0000-4000-8300-000000000103";

const stripOf = (page: Page) => page.getByRole("navigation", { name: "Days of the trip" });
const chipFor = (page: Page, day: string) => stripOf(page).locator(`a[href$="day=${day}"]`);

async function gapUnderStrip(strip: Locator, target: Locator): Promise<number | null> {
  const stripBox = await strip.boundingBox();
  const targetBox = await target.boundingBox();
  if (!stripBox || !targetBox) return null;
  return targetBox.y - (stripBox.y + stripBox.height);
}

function settledScroll(page: Page): Promise<number> {
  return page.evaluate(
    () =>
      new Promise<number>((resolve) => {
        let last = window.scrollY;
        let still = 0;
        const tick = () => {
          const y = window.scrollY;
          still = y === last ? still + 1 : 0;
          last = y;
          if (still >= 12) resolve(Math.round(y));
          else requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
      }),
  );
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

test("the strip stays visible while a day is read, and back and forward each return to their own place", async ({ pageSignedInAs }) => {
  const page = await pageSignedInAs("kenny", `/trips/${DECEMBER_TRIP}`);
  const strip = stripOf(page);
  const first = await strip.locator("[aria-current=date]").getAttribute("aria-label");
  const scrollY = () => page.evaluate(() => Math.round(window.scrollY));
  await chipFor(page, "2026-12-05").scrollIntoViewIfNeeded();
  await page.mouse.wheel(0, 120);
  await expect.poll(scrollY).toBeGreaterThan(60);
  const earlier = await scrollY();
  await chipFor(page, "2026-12-05").click();
  await expect(page).toHaveURL(/day=2026-12-05/);
  await page.mouse.wheel(0, 400);
  await expect(strip).toBeInViewport();
  await expect.poll(scrollY).toBeGreaterThan(earlier + 40);
  const later = await settledScroll(page);
  await page.goBack();
  await expect(page).not.toHaveURL(/day=2026-12-05/);
  await expect(strip.locator("[aria-current=date]")).toHaveAttribute("aria-label", first ?? "");
  await expect(strip).toHaveAttribute("data-scroll-restored", /\|/);
  expect(Math.abs((await settledScroll(page)) - earlier), "back returns to the place before the tap").toBeLessThanOrEqual(2);
  await page.goForward();
  await expect(page).toHaveURL(/day=2026-12-05/);
  await expect(chipFor(page, "2026-12-05")).toHaveAttribute("aria-current", "date");
  await expect(strip).toHaveAttribute("data-scroll-restored", /day=2026-12-05/);
  expect(Math.abs((await settledScroll(page)) - later), "forward returns to the place it was left").toBeLessThanOrEqual(2);
});

test("back from an item's details returns to the earlier place on the trip page", async ({ pageSignedInAs }) => {
  const page = await pageSignedInAs("kenny", `/trips/${PACKED_TRIP}`);
  await chipFor(page, "2027-03-09").click();
  await expect(page).toHaveURL(/day=2027-03-09/);
  await page.mouse.wheel(0, 500);
  const earlier = await settledScroll(page);
  expect(earlier).toBeGreaterThan(100);
  const row = page.locator("#day-panel a[href*='/items/']").last();
  await row.scrollIntoViewIfNeeded();
  const leftAt = await settledScroll(page);
  await row.click();
  await expect(page).toHaveURL(/\/items\//);
  await page.goBack();
  await expect(page).toHaveURL(/day=2027-03-09/);
  await expect(stripOf(page)).toHaveAttribute("data-scroll-restored", /day=2027-03-09/);
  expect(Math.abs((await settledScroll(page)) - leftAt), "back from the details page returns to where the row was tapped").toBeLessThanOrEqual(2);
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
