import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { TRIP_ID, USERS } from "@/fixtures/december-trip";
import { kenny, testContext } from "@/server/testing";
import { getTripView } from "@/server/services/trip-service";
import type { ServiceContext } from "@/server/services/context";
import ImportPage from "./page";

const world = vi.hoisted(() => {
  const holder: { ctx: ServiceContext | null; canEdit: boolean; google: boolean; items: boolean } = { ctx: null, canEdit: true, google: true, items: true };
  return { holder };
});

vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new Error("notFound");
  },
}));
vi.mock("@/server/app-context", () => ({ appUrl: () => "https://trips.test" }));
vi.mock("@/server/web", () => ({
  loadTripPage: async () => {
    if (!world.holder.ctx) throw new Error("no test context");
    const view = await getTripView(world.holder.ctx, TRIP_ID, kenny);
    return { ctx: world.holder.ctx, user: { id: USERS.kenny.id }, view: { ...view, items: world.holder.items ? view.items : [], permissions: { ...view.permissions, canEdit: world.holder.canEdit } } };
  },
}));
vi.mock("@/server/google/import-guard", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/server/google/import-guard")>()),
  importOAuthConfig: () => (world.holder.google ? { clientId: "c", clientSecret: "s", redirectUri: "https://trips.test/api/google/import/callback" } : null),
}));

async function page(query: Record<string, string> = {}) {
  return renderToStaticMarkup(await ImportPage({ params: Promise.resolve({ tripId: TRIP_ID }), searchParams: Promise.resolve(query) }));
}

beforeEach(async () => {
  world.holder.ctx = (await testContext({ withItems: true })).ctx;
  world.holder.canEdit = true;
  world.holder.google = true;
  world.holder.items = true;
});

describe("the import page", () => {
  it("with Google configured, starts with a Google Calendar row that links to its import page", async () => {
    const html = await page();
    expect(html).toContain(`href="/trips/${TRIP_ID}/import/google"`);
    expect(html).toContain("Google Calendar");
    expect(html).toContain("Pick calendars and dates. Read only.");
    expect(html.indexOf("Google Calendar")).toBeLessThan(html.indexOf("Calendar file"));
    expect(html.indexOf("Import bookings")).toBeLessThan(html.indexOf("Google Calendar"));
  });

  it("without Google configured, the row is not there", async () => {
    world.holder.google = false;
    const html = await page();
    expect(html).not.toContain("/import/google");
    expect(html).not.toContain("Pick calendars and dates. Read only.");
    expect(html).toContain("Calendar file");
  });

  it("prefills the dates around the trip, with the hint for a trip that has dates", async () => {
    const html = await page();
    expect(html).toContain('name="from" value="2026-11-30"');
    expect(html).toContain("Events outside these dates are left out.");
  });

  it("leaves the dates empty on a trip with none, with the other hint", async () => {
    world.holder.items = false;
    const html = await page();
    expect(html).toContain('name="from" value=""');
    expect(html).toContain("Leave empty to bring in every event.");
  });

  it("does not offer the link form while its rate limit rule is missing", async () => {
    expect(await page()).not.toContain("Calendar link");
  });

  it("is a 404 for someone who cannot edit", async () => {
    world.holder.canEdit = false;
    await expect(page()).rejects.toThrow("notFound");
  });

  it("shows the problem for a known code and ignores an unknown one", async () => {
    expect(await page({ problem: "from_after_to" })).toContain("The From date is after the To date.");
    expect(await page({ problem: "<script>" })).not.toContain('role="alert"');
  });
});
