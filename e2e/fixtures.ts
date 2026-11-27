import { expect, test as base, type Page } from "@playwright/test";

export type DemoUser = "kenny" | "jacob";

export async function signInAs(page: Page, user: DemoUser, next = "/"): Promise<void> {
  await page.goto(`/api/dev/sign-in?as=${user}&next=${encodeURIComponent(next)}`);
}

interface Fixtures {
  signIn: (user: DemoUser, next?: string) => Promise<void>;
  pageSignedInAs: (user: DemoUser, next?: string) => Promise<Page>;
}

export const test = base.extend<Fixtures>({
  signIn: async ({ page }, provide) => {
    await provide((user, next) => signInAs(page, user, next));
  },
  pageSignedInAs: async ({ browser }, provide) => {
    const contexts: { close: () => Promise<void> }[] = [];
    await provide(async (user, next) => {
      const context = await browser.newContext();
      contexts.push(context);
      const page = await context.newPage();
      await signInAs(page, user, next);
      return page;
    });
    for (const context of contexts) await context.close();
  },
});

export { expect };
