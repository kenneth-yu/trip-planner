import { expect, test as base, type Browser, type Page } from "@playwright/test";

export type DemoUser = "kenny" | "jacob";

export async function signInAs(page: Page, user: DemoUser, next = "/"): Promise<void> {
  await page.goto(`/api/dev/sign-in?as=${user}&next=${encodeURIComponent(next)}`);
}

export async function pageSignedInAs(browser: Browser, user: DemoUser, next = "/"): Promise<Page> {
  const context = await browser.newContext();
  const page = await context.newPage();
  await signInAs(page, user, next);
  return page;
}

export const test = base.extend<{ signIn: (user: DemoUser, next?: string) => Promise<void> }>({
  signIn: async ({ page }, provide) => {
    await provide((user, next) => signInAs(page, user, next));
  },
});

export { expect };
