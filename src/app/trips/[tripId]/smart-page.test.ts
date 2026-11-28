import { eq } from "drizzle-orm";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { TRIP_ID, USERS } from "@/fixtures/december-trip";
import { present } from "@/testing/present";
import * as t from "@/server/db/schema";
import { kenny, testContext } from "@/server/testing";
import type { ServiceContext } from "@/server/services/context";
import { getTripView, updateItem } from "@/server/services/trip-service";
import { saveTipPreferences } from "@/server/services/preference-service";
import { fromLocal } from "@/domain/time/format";
import type { Requester } from "@/domain/types";
import TripPage from "./page";

const world = vi.hoisted(() => {
  const state: { ctx: ServiceContext | null; requester: Requester } = { ctx: null, requester: { kind: "link", homeZone: "UTC" } };
  return state;
});

vi.mock("next/navigation", () => ({ useSearchParams: () => new URLSearchParams(), useRouter: () => ({ refresh: () => undefined }), usePathname: () => "/" }));

vi.mock("@/server/web", async () => {
  const { getTripView: view } = await import("@/server/services/trip-service");
  return {
    loadTripPage: async (tripId: string) => {
      if (!world.ctx) throw new Error("no test context");
      return { ctx: world.ctx, user: { id: "u", homeZone: "America/New_York" }, requester: world.requester, view: await view(world.ctx, tripId, world.requester) };
    },
  };
});

const VIEWER = { id: "00000000-0000-4000-8100-000000000d01", name: "Mom Feldman" };

async function render() {
  return renderToStaticMarkup(await TripPage({ params: Promise.resolve({ tripId: TRIP_ID }), searchParams: Promise.resolve({ day: "all" }) }));
}

async function slipDinner(ctx: ServiceContext) {
  const view = await getTripView(ctx, TRIP_ID, kenny);
  const plan = present(view.items.find((i) => i.title === "Jantzen Tailor"));
  const start = fromLocal("2026-12-09T06:30", "Asia/Hong_Kong");
  const length = Date.parse(plan.end.at) - Date.parse(plan.start.at);
  await updateItem(ctx, TRIP_ID, plan.id, kenny, { title: "Dinner at Jantzen", start, end: { at: new Date(Date.parse(start.at) + length).toISOString(), zone: "Asia/Hong_Kong" } });
}

describe("the trip page and travel tips", () => {
  beforeEach(async () => {
    const built = await testContext();
    world.ctx = built.ctx;
    world.requester = kenny;
    await built.db.insert(t.users).values({ id: VIEWER.id, name: VIEWER.name, email: "mom@example.com" });
    await built.db.insert(t.memberships).values({ tripId: TRIP_ID, userId: VIEWER.id, role: "viewer" });
  });

  it("shows an editor tips with the intro once, linking to Turn off tips, and never again after", async () => {
    const first = await render();
    expect(first).toContain("Be at the airport by 5:50am.");
    expect(first).toContain("Hide tips like this");
    expect(first).toContain("Tips like this are optional.");
    expect(first).toContain('href="/account#travel-smarts"');
    const second = await render();
    expect(second).toContain("Be at the airport by 5:50am.");
    expect(second).not.toContain("Tips like this are optional.");
  });

  it("with tips off shows no tips and no intro, but a wrong time warning stays with its actions", async () => {
    const ctx = present(world.ctx);
    await slipDinner(ctx);
    const before = await render();
    expect(before).toContain("Be at the airport by 5:50am.");
    expect(before).toContain("Dinner at 6:30am? Did you mean 6:30pm?");
    await saveTipPreferences(ctx, USERS.kenny.id, { tipsOn: false, kindsOff: [] });
    const after = await render();
    expect(after).not.toContain("Be at the airport by 5:50am.");
    expect(after).not.toContain("Store your bags?");
    expect(after).not.toContain("Tips like this are optional.");
    expect(after).toContain("Dinner at 6:30am? Did you mean 6:30pm?");
    expect(after).toContain("Change to 6:30pm");
  });

  it("shows a viewer no tips, no intro and no buttons, and does not use up the intro", async () => {
    world.requester = { kind: "member", userId: VIEWER.id, homeZone: "America/New_York" };
    const html = await render();
    expect(html).not.toContain("Be at the airport by");
    expect(html).not.toContain("Store your bags?");
    expect(html).not.toContain("Tips like this are optional.");
    expect(html).not.toContain("Hide tips like this");
    expect(html).not.toContain("Change to ");
    const ctx = present(world.ctx);
    const [row] = await ctx.db.select({ seen: t.users.tipsIntroSeen }).from(t.users).where(eq(t.users.id, VIEWER.id));
    expect(row?.seen).toBe(false);
  });
});
