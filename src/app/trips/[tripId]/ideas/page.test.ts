import { renderToStaticMarkup } from "react-dom/server";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { TRIP_ID, USERS } from "@/fixtures/december-trip";
import { jacob, kenny, testContext } from "@/server/testing";
import type { ServiceContext } from "@/server/services/context";
import { createIdea, markIdeaDone } from "@/server/services/idea-service";
import { getTripView } from "@/server/services/trip-service";
import * as t from "@/server/db/schema";
import IdeasPage from "./page";

const world = vi.hoisted(() => {
  const state: { ctx: ServiceContext | null; who: "kenny" | "jacob" | "viewer" } = { ctx: null, who: "kenny" };
  return state;
});

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: () => undefined }), useSearchParams: () => new URLSearchParams() }));
vi.mock("@/server/web", () => ({
  loadTripPage: async () => {
    if (!world.ctx) throw new Error("no test context");
    const requester = world.who === "kenny" ? kenny : world.who === "jacob" ? jacob : { kind: "member" as const, userId: "00000000-0000-4000-8000-0000000000c3", homeZone: "America/New_York" };
    return { ctx: world.ctx, requester, view: await getTripView(world.ctx, TRIP_ID, requester) };
  },
}));

beforeAll(() => {
  process.env.SESSION_SECRET = "test-secret-test-secret-test-secret-0123";
});

beforeEach(async () => {
  const env = await testContext({ withItems: true });
  world.ctx = env.ctx;
  world.who = "kenny";
  await env.db.insert(t.users).values({ id: "00000000-0000-4000-8000-0000000000c3", email: "mom@example.test", name: "Mom", homeZone: "America/New_York" });
  await env.db.insert(t.memberships).values({ tripId: TRIP_ID, userId: "00000000-0000-4000-8000-0000000000c3", role: "viewer" });
});

const render = async () => renderToStaticMarkup(await IdeasPage({ params: Promise.resolve({ tripId: TRIP_ID }), searchParams: Promise.resolve({}) }));

describe("the Ideas page", () => {
  it("says what it is for when there are none, and offers to add one", async () => {
    const html = await render();
    expect(html).toContain(">Ideas</h2>");
    expect(html).toContain("No ideas yet. Add things you might do here, with or without a place. They show up on that city&#x27;s days.");
    expect(html).toContain("Add an idea</button>");
  });

  it("groups by city with its dates, then Anywhere, in the spec's words, with the place and note under each title", async () => {
    if (!world.ctx) throw new Error("no test context");
    await createIdea(world.ctx, TRIP_ID, kenny, { title: "Buy gold", where: "Shenzhen" });
    await createIdea(world.ctx, TRIP_ID, kenny, { title: "Massage", where: "Tianyuan Foot Spa, Luohu, Shenzhen", note: "Ask for Ms Lin" });
    await createIdea(world.ctx, TRIP_ID, kenny, { title: "Try the local beer" });
    const html = await render();
    expect(html).toContain(">Shenzhen, Dec 6 to 10</h3>");
    expect(html).toContain(">Anywhere</h3>");
    expect(html.indexOf("Shenzhen, Dec 6 to 10")).toBeLessThan(html.indexOf("Anywhere"));
    expect(html).toContain("Tianyuan Foot Spa, Luohu, Shenzhen · Ask for Ms Lin");
    expect(html).toContain('aria-expanded="false"');
  });

  it("folds finished ideas under Done with the day and the person", async () => {
    if (!world.ctx) throw new Error("no test context");
    const idea = await createIdea(world.ctx, TRIP_ID, kenny, { title: "Buy gold", where: "Shenzhen" });
    await markIdeaDone(world.ctx, TRIP_ID, idea.id, jacob);
    const html = await render();
    expect(html).toContain("<summary>Done (1)</summary>");
    expect(html).toMatch(/Done [A-Z][a-z]{2} \d+, Jacob/);
    expect(html).toContain("Not done</button>");
    expect(html).not.toContain(`>${USERS.jacob.id}<`);
  });

  it("leaves another person's only me idea out of the page entirely", async () => {
    if (!world.ctx) throw new Error("no test context");
    await createIdea(world.ctx, TRIP_ID, jacob, { title: "Surprise ring", where: "Shenzhen", visibility: "only_me", note: "secret note" });
    expect(await render()).not.toMatch(/Surprise ring|secret note/);
    world.who = "jacob";
    expect(await render()).toContain("Surprise ring");
  });

  it("shows a viewer the list and none of the ways to change it", async () => {
    if (!world.ctx) throw new Error("no test context");
    await createIdea(world.ctx, TRIP_ID, kenny, { title: "Buy gold", where: "Shenzhen" });
    world.who = "viewer";
    const html = await render();
    expect(html).toContain("Buy gold");
    expect(html).not.toContain("Add an idea");
    expect(html).not.toContain("Not done");
  });
});
