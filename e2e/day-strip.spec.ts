import { expect, test } from "./fixtures";
import { DECEMBER_TRIP } from "./trips";

const PACKED_TRIP = "00000000-0000-4000-8300-000000000103";

test("tapping a day keeps the chosen day just under the strip, with its rows in view", async ({ pageSignedInAs }) => {
  const page = await pageSignedInAs("kenny", `/trips/${PACKED_TRIP}`);
  const strip = page.getByRole("navigation", { name: "Days of the trip" });
  await expect(strip).toBeVisible();
  await strip.getByRole("link", { name: /^Wed Mar 10/ }).click();
  await expect(page).toHaveURL(/day=2027-03-10/);
  const panel = page.locator("#day-panel");
  await expect
    .poll(async () => {
      const stripBox = await strip.boundingBox();
      const panelBox = await panel.boundingBox();
      if (!stripBox || !panelBox) return null;
      return Math.round(panelBox.y - (stripBox.y + stripBox.height));
    })
    .toBeGreaterThanOrEqual(0);
  await expect
    .poll(async () => {
      const stripBox = await strip.boundingBox();
      const panelBox = await panel.boundingBox();
      if (!stripBox || !panelBox) return null;
      return panelBox.y - (stripBox.y + stripBox.height) < 24;
    })
    .toBe(true);
  await expect(strip).toBeInViewport();
  await expect(panel.locator("summary").first()).toContainText("Wed Mar 10");
  await expect(panel.locator("summary").first()).toBeInViewport();
  const firstRow = panel.locator("a").first();
  await expect(firstRow).toBeInViewport();
});

test("the strip stays visible while a day is read and back returns to the previous day", async ({ pageSignedInAs }) => {
  const page = await pageSignedInAs("kenny", `/trips/${DECEMBER_TRIP}`);
  const strip = page.getByRole("navigation", { name: "Days of the trip" });
  const first = await strip.locator("[aria-current=date]").getAttribute("aria-label");
  await strip.getByRole("link", { name: /^Sat Dec 5/ }).click();
  await expect(page).toHaveURL(/day=2026-12-05/);
  await page.mouse.wheel(0, 400);
  await expect(strip).toBeInViewport();
  await page.goBack();
  await expect(page).not.toHaveURL(/day=2026-12-05/);
  await expect(strip.locator("[aria-current=date]")).toHaveAttribute("aria-label", first ?? "");
});
