import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { TRIP_ID } from "@/fixtures/december-trip";
import { kenny, testContext } from "@/server/testing";
import { getTripView } from "@/server/services/trip-service";
import type { ServiceContext } from "@/server/services/context";
import InboxPage from "./page";

const world = vi.hoisted(() => {
  const holder: { ctx: ServiceContext | null; canEdit: boolean } = { ctx: null, canEdit: true };
  return { holder };
});

vi.mock("next/navigation", () => ({ useSearchParams: () => new URLSearchParams(), useRouter: () => ({ refresh: () => undefined }) }));
vi.mock("@/server/web", () => ({
  loadTripPage: async () => {
    if (!world.holder.ctx) throw new Error("no test context");
    const view = await getTripView(world.holder.ctx, TRIP_ID, kenny);
    return { ctx: world.holder.ctx, requester: kenny, view: { ...view, permissions: { ...view.permissions, canEdit: world.holder.canEdit } } };
  },
}));

beforeEach(async () => {
  world.holder.ctx = (await testContext({ withItems: false })).ctx;
  world.holder.canEdit = true;
});

async function render(query: Record<string, string> = {}) {
  const element = await InboxPage({ params: Promise.resolve({ tripId: TRIP_ID }), searchParams: Promise.resolve(query) });
  return renderToStaticMarkup(element);
}

describe("the line after a Google import", () => {
  it("shows the count from the address as the first status line", async () => {
    const html = await render({ imported: "18", matched: "5" });
    expect(html).toContain("18 events are waiting in your inbox. 5 look like things already on the trip.</p>");
  });

  it.each([[""], [" 7 "], ["1e3"], ["0x10"], ["abc"]])("shows nothing for %j", async (imported) => {
    expect(await render({ imported })).not.toContain("waiting in your inbox");
  });
});
