import { expect, test } from "./fixtures";
import { DECEMBER_TRIP } from "./trips";

test("sign out returns to the sign in screen and a trip deep link redirects to sign in with next", async ({ page, signIn }) => {
  await signIn("kenny");
  await page.getByRole("button", { name: "Sign out", exact: true }).click();
  await expect(page).toHaveURL(/\/sign-in$/);
  await expect(page.getByRole("heading", { name: "Sign in", exact: true })).toBeVisible();

  await page.goto(`/trips/${DECEMBER_TRIP}?day=2026-12-05`);
  const url = new URL(page.url());
  expect(url.pathname).toBe("/sign-in");
  expect(url.searchParams.get("next")).toBe(`/trips/${DECEMBER_TRIP}?day=2026-12-05`);
  await expect(page.getByRole("heading", { name: "Sign in", exact: true })).toBeVisible();
});
