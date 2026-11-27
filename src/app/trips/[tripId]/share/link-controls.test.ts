import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { TRIP_ID } from "@/fixtures/december-trip";
import type { Requester } from "@/domain/types";
import { present } from "@/testing/present";
import { jacob, kenny, testContext } from "@/server/testing";
import * as t from "@/server/db/schema";
import { getTripView } from "@/server/services/trip-service";
import { resolveViewLink } from "@/server/services/view-link-service";
import type { ServiceContext } from "@/server/services/context";
import SharePage from "./page";
import { disableLinkAction, enableLinkAction, rotateLinkAction, setLinkDeadlinesAction, setViewerDeadlinesAction, type LinkRevealState, type SwitchState } from "./actions";

const world = vi.hoisted(() => {
  const state: { ctx: ServiceContext | null; requester: Requester | null } = { ctx: null, requester: null };
  return state;
});

vi.mock("next/cache", () => ({ revalidatePath: () => undefined }));
vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new Error("notFound");
  },
}));
vi.mock("@/server/web", () => ({
  loadTripPage: async (tripId: string) => {
    if (!world.ctx || !world.requester) throw new Error("no test context");
    const view = await getTripView(world.ctx, tripId, world.requester);
    return { ctx: world.ctx, requester: world.requester, view, user: { id: world.requester.kind === "member" ? world.requester.userId : "" } };
  },
}));

const noReveal: LinkRevealState = { url: null, error: null };
const noSwitch: SwitchState = { saved: false, error: null };
const viewerId = "00000000-0000-4000-8100-000000000a03";

function form(fields: Record<string, string>) {
  const data = new FormData();
  for (const [key, value] of Object.entries(fields)) data.set(key, value);
  return data;
}

const html = async () => renderToStaticMarkup(await SharePage({ params: Promise.resolve({ tripId: TRIP_ID }), searchParams: Promise.resolve({}) }));
const tokenOf = (url: string | null) => (url ?? "").slice((url ?? "").lastIndexOf("/") + 1);

describe("the link section of the share page", () => {
  beforeEach(async () => {
    vi.stubEnv("SESSION_SECRET", "test-secret-test-secret-test-secret-0123");
    const env = await testContext();
    await env.db.delete(t.shareLinks).where(eq(t.shareLinks.tripId, TRIP_ID));
    world.ctx = env.ctx;
    world.requester = kenny;
  });

  it("sits at the bottom, off by default, with a switch and nothing else", async () => {
    const page = await html();
    expect(page.indexOf("Link for family and friends")).toBeGreaterThan(page.indexOf("People on this trip"));
    expect(page).toContain("Anyone with the link can see this trip");
    expect(page).toContain('role="switch"');
    expect(page).toContain("They see times and places, never codes, seats or prices, and never anything you hid.");
    for (const absent of ["Show deadlines on the link", "Make a new link", "Viewers see deadlines"]) expect(page).not.toContain(absent);
  });

  it("turns on once, shows the link only in the action result and never in the page", async () => {
    const revealed = await enableLinkAction(noReveal, form({ tripId: TRIP_ID }));
    expect(revealed.url).toMatch(/\/v\/tpv_/);
    const page = await html();
    expect(page).toContain("Show deadlines on the link");
    expect(page).toContain("Make a new link");
    expect(page).not.toContain(tokenOf(revealed.url));
    expect(page).toContain("You saw this link when you made it. To send it to someone else, forward the message you sent it in.");
    expect(page).toContain("A new link stops the current one working.");
  });

  it("makes a new link that replaces the old one at once", async () => {
    const ctx = present(world.ctx);
    const first = await enableLinkAction(noReveal, form({ tripId: TRIP_ID }));
    const second = await rotateLinkAction(noReveal, form({ tripId: TRIP_ID }));
    expect(await resolveViewLink(ctx, tokenOf(first.url))).toBeNull();
    expect(await resolveViewLink(ctx, tokenOf(second.url))).toBe(TRIP_ID);
  });

  it("turns off and says what happened to a wrong request", async () => {
    await enableLinkAction(noReveal, form({ tripId: TRIP_ID }));
    expect(await disableLinkAction(noSwitch, form({ tripId: TRIP_ID }))).toEqual({ saved: true, error: null });
    expect(await rotateLinkAction(noReveal, form({ tripId: TRIP_ID }))).toEqual({ url: null, error: "That already changed. Reload the page." });
  });

  it("shows the viewer switch only when a viewer is on the trip", async () => {
    const ctx = present(world.ctx);
    await ctx.db.insert(t.users).values({ id: viewerId, name: "Casey Park", email: "casey@example.test" });
    await ctx.db.insert(t.memberships).values({ tripId: TRIP_ID, userId: viewerId, role: "viewer" });
    expect(await html()).toContain("Viewers see deadlines");
    expect(await setViewerDeadlinesAction(noSwitch, form({ tripId: TRIP_ID, on: "true" }))).toEqual({ saved: true, error: null });
    expect(await html()).toContain("Viewers see deadlines");
  });

  it("refuses an editor on every action with the same sentence", async () => {
    world.requester = jacob;
    const results = [
      await enableLinkAction(noReveal, form({ tripId: TRIP_ID })),
      await rotateLinkAction(noReveal, form({ tripId: TRIP_ID })),
    ];
    const switches = [
      await disableLinkAction(noSwitch, form({ tripId: TRIP_ID })),
      await setLinkDeadlinesAction(noSwitch, form({ tripId: TRIP_ID, on: "true" })),
      await setViewerDeadlinesAction(noSwitch, form({ tripId: TRIP_ID, on: "true" })),
    ];
    expect(new Set([...results, ...switches].map((r) => r.error))).toEqual(new Set(["Only the trip owner can change this."]));
    await expect(html()).rejects.toThrow("notFound");
  });

  it("says to wait after too many changes in a row", async () => {
    await enableLinkAction(noReveal, form({ tripId: TRIP_ID }));
    let last: LinkRevealState = noReveal;
    for (let i = 0; i < 21; i++) last = await rotateLinkAction(noReveal, form({ tripId: TRIP_ID }));
    expect(last).toEqual({ url: null, error: "Too many changes in a row. Wait a minute and try again." });
  });
});
