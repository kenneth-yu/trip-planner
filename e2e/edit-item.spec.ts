import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "./fixtures";
import { addPlan, DECEMBER_TRIP, STANFORD_HOTEL } from "./trips";

const JACOB_TRAVELER = "00000000-0000-4000-8200-000000000002";
const CODE = "PLACEHOLDER_STAY1";

test.setTimeout(120_000);

test("Add confirmation code opens the edit page on the traveler's field, saves, and shows the code with Saved", async ({ pageSignedInAs }) => {
  const jacob = await pageSignedInAs("jacob", `/trips/${DECEMBER_TRIP}?day=2026-12-05`);
  await jacob.getByRole("link", { name: /Stanford Hotel/ }).filter({ visible: true }).first().click();
  await expect(jacob).toHaveURL(/\/items\//);
  await expect(jacob.getByRole("link", { name: "Edit", exact: true })).toBeVisible();
  const box = await jacob.getByRole("link", { name: /^Back to / }).boundingBox();
  expect(box?.height).toBeGreaterThanOrEqual(44);
  await jacob.getByRole("link", { name: "Add confirmation code" }).click();
  await expect(jacob).toHaveURL(/\/edit\?focus=code$/);
  const field = jacob.locator(`[name="code:${JACOB_TRAVELER}"]`);
  await expect(field).toBeFocused();
  await field.fill(CODE);
  await jacob.getByRole("button", { name: "Save changes" }).click();
  await expect(jacob).toHaveURL(/\/items\/[0-9a-f-]+$/);
  await expect(jacob.getByRole("status").filter({ hasText: "Saved" })).toBeVisible();
  await expect(jacob.getByText(CODE)).toBeVisible();
  await expect(jacob.getByRole("link", { name: "Add confirmation code" })).toHaveCount(0);
  await jacob.reload();
  await expect(jacob.getByRole("status").filter({ hasText: "Saved" })).toHaveCount(0);
});

test("Cancel returns to the details page without saving or asking", async ({ pageSignedInAs }) => {
  const kenny = await pageSignedInAs("kenny", `/trips/${DECEMBER_TRIP}?day=2026-12-05`);
  await kenny.getByRole("link", { name: /Jantzen Tailor/ }).filter({ visible: true }).first().click();
  await expect(kenny).toHaveURL(/\/items\//);
  const details = kenny.url();
  await kenny.getByRole("link", { name: "Edit", exact: true }).click();
  await expect(kenny.getByRole("heading", { name: "Edit Jantzen Tailor" })).toBeVisible();
  await kenny.getByRole("link", { name: "Cancel" }).click();
  await expect(kenny).toHaveURL(details);
});

test("Delete asks first, keeps focus on Keep, then lands on the day with Deleted once", async ({ pageSignedInAs }) => {
  const kenny = await pageSignedInAs("kenny", `/trips/${DECEMBER_TRIP}`);
  await addPlan(kenny, DECEMBER_TRIP, { title: "Duplicate lunch", date: "2026-12-03", starts: "12:00", ends: "13:00" });
  await kenny.getByRole("link", { name: /Duplicate lunch/ }).filter({ visible: true }).first().click();
  await kenny.getByRole("button", { name: "Delete" }).click();
  await expect(kenny.getByText("Delete Duplicate lunch? This cannot be undone.")).toBeVisible();
  await expect(kenny.getByRole("button", { name: "Keep" })).toBeFocused();
  await kenny.getByRole("button", { name: "Keep" }).click();
  await expect(kenny.getByRole("link", { name: "Edit", exact: true })).toBeVisible();
  await kenny.getByRole("button", { name: "Delete" }).click();
  await kenny.getByRole("button", { name: "Delete" }).click();
  await expect(kenny).toHaveURL(/\/trips\/[0-9a-f-]+\?day=2026-12-03$/);
  await expect(kenny.getByRole("status").filter({ hasText: "Item deleted." }).first()).toBeVisible();
  await expect(kenny.getByText("Duplicate lunch", { exact: true })).toHaveCount(0);
  await kenny.reload();
  await expect(kenny.getByRole("status").filter({ hasText: "Deleted" })).toHaveCount(0);
});

test("the details, edit, delete confirmation and add pages have no serious or critical axe violations", async ({ pageSignedInAs }) => {
  const kenny = await pageSignedInAs("kenny", `/trips/${DECEMBER_TRIP}/items/${STANFORD_HOTEL}`);
  const serious = async () => (await new AxeBuilder({ page: kenny }).analyze()).violations.filter((v) => v.impact === "serious" || v.impact === "critical").map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`);
  await expect(kenny.getByRole("link", { name: "Edit", exact: true })).toBeVisible();
  expect(await serious()).toEqual([]);
  await kenny.getByRole("button", { name: "Delete" }).click();
  await expect(kenny.getByRole("button", { name: "Keep" })).toBeVisible();
  expect(await serious()).toEqual([]);
  await kenny.goto(`/trips/${DECEMBER_TRIP}/items/${STANFORD_HOTEL}/edit`);
  await expect(kenny.getByRole("button", { name: "Save changes" })).toBeVisible();
  expect(await serious()).toEqual([]);
  await kenny.goto(`/trips/${DECEMBER_TRIP}/add`);
  await expect(kenny.getByRole("button", { name: /^Add / })).toBeVisible();
  expect(await serious()).toEqual([]);
});

test("every field on the edit page has a label that attaches to its input", async ({ pageSignedInAs }) => {
  const kenny = await pageSignedInAs("kenny", `/trips/${DECEMBER_TRIP}/items/${STANFORD_HOTEL}/edit?focus=code`);
  await expect(kenny.getByLabel("Name")).toBeVisible();
  await expect(kenny.getByLabel("Booking reference")).toBeVisible();
  await expect(kenny.getByLabel("Kenneth")).toBeVisible();
});
