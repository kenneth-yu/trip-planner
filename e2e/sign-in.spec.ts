import { expect, test } from "./fixtures";

test("dev sign in as Kenny lands on the trip list", async ({ page, signIn }) => {
  await signIn("kenny");
  await expect(page).toHaveURL("/");
  await expect(page.getByRole("heading", { name: "Your trips" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Asia, December 2026" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Sign out" })).toBeVisible();
});
