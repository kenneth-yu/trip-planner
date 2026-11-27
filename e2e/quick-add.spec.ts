import { expect, test } from "./fixtures";
import { LISBON_TRIP } from "./trips";

test("quick add NH159 from the Add link shows both local times and the Added marker", async ({ page, signIn }) => {
  await signIn("kenny", `/trips/${LISBON_TRIP}`);
  await page.getByRole("navigation").getByRole("link", { name: "Add" }).click();
  await expect(page.getByRole("heading", { name: "Add to trip" })).toBeVisible();

  await page.locator("[name=flightNumber]").fill("NH159");
  await page.locator("[name=date]").fill("2026-12-01");
  await page.locator("[name=from]").fill("JFK");
  await page.locator("[name=to]").fill("HND");
  await page.locator("[name=departs]").fill("00:55");
  await page.locator("[name=arrives]").fill("05:25");
  await expect(page.getByText("Departs (New York time)")).toBeVisible();
  await expect(page.getByText("Arrives (Tokyo time)")).toBeVisible();
  await page.getByRole("button", { name: "Add flight" }).click();

  await expect(page).toHaveURL(/day=2026-12-01&added=/);
  await expect(page.getByText("Added", { exact: true }).filter({ visible: true }).first()).toBeVisible();
  const card = page.getByRole("listitem").filter({ hasText: "NH159" }).filter({ visible: true }).first();
  await expect(card).toContainText("12:55am");
  await expect(card).toContainText("New York");
  await expect(card).toContainText("5:25am");
  await expect(card).toContainText("Tokyo");
});
