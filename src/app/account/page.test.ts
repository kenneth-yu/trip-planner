import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { TRIP_ID, USERS } from "@/fixtures/december-trip";
import { present } from "@/testing/present";
import * as t from "@/server/db/schema";
import { jacob, kenny, testContext } from "@/server/testing";
import { quickAddItem } from "@/server/services/trip-service";
import type { ServiceContext } from "@/server/services/context";
import AccountPage from "./page";

const world = vi.hoisted(() => {
  const state: { ctx: ServiceContext | null; user: { id: string; name: string; email: string } } = {
    ctx: null,
    user: { id: "", name: "", email: "" },
  };
  return state;
});

vi.mock("@/server/app-context", () => ({
  requestContext: async () => {
    if (!world.ctx) throw new Error("no test context");
    return world.ctx;
  },
}));

vi.mock("@/server/web", () => ({ requireUser: async () => world.user }));

const kennyUser = { id: USERS.kenny.id, name: USERS.kenny.name, email: USERS.kenny.email };
const jacobUser = { id: USERS.jacob.id, name: USERS.jacob.name, email: USERS.jacob.email };

async function render() {
  return renderToStaticMarkup(await AccountPage());
}

describe("the account page", () => {
  beforeEach(async () => {
    world.ctx = (await testContext()).ctx;
    world.user = kennyUser;
  });

  it("shows who is signed in and the data section with one filled button", async () => {
    const html = await render();
    expect(html).toContain("Your account");
    expect(html).toContain("Signed in as Kenneth Yu");
    expect(html).toContain(USERS.kenny.email);
    expect(html).toContain("Your data");
    expect(html).toContain("Download your data");
    expect(html).toContain("The file has your confirmation codes in it. Keep it somewhere private.");
  });

  it("is blocked for an owner whose trip has other people, naming the trip and linking to share and delete", async () => {
    const html = await render();
    expect(html).toContain("You own trips that other people are on.");
    expect(html).toContain("People on this trip");
    expect(html).toContain("Delete trip");
    expect(html).toContain(`/trips/${TRIP_ID}/share`);
    expect(html).toContain(`/trips/${TRIP_ID}/settings/delete`);
    expect(html).not.toContain("Delete account");
    expect(html).not.toContain("Type delete to confirm");
  });

  it("does not list solo trips as blocking", async () => {
    const ctx = present(world.ctx);
    await ctx.db.insert(t.trips).values({ id: "00000000-0000-4000-8300-0000000000a1", name: "Solo weekend", ownerId: USERS.kenny.id });
    await ctx.db.insert(t.memberships).values({ tripId: "00000000-0000-4000-8300-0000000000a1", userId: USERS.kenny.id, role: "owner" });
    expect(await render()).not.toContain("Solo weekend");
  });

  it("offers deletion to someone who owns nothing shared, with no hidden items choice", async () => {
    world.user = jacobUser;
    const html = await render();
    expect(html).toContain("Delete your account");
    expect(html).toContain("This deletes your account, the trips only you are on");
    expect(html).toContain("Type delete to confirm");
    expect(html).toContain("Delete account");
    expect(html).not.toContain("Things you shared with only some people");
    expect(html).not.toContain("You own trips");
  });

  it("shows the hidden items choice only to the person who made specific items in a trip that stays", async () => {
    const ctx = present(world.ctx);
    await quickAddItem(
      ctx,
      TRIP_ID,
      jacob,
      { type: "plan", title: "Birthday dinner", city: "Tokyo", startLocal: "2026-12-03T19:00", endLocal: "2026-12-03T21:00" },
      { visibility: "specific", visibleToUserIds: [USERS.kenny.id] },
    );
    world.user = jacobUser;
    const html = await render();
    expect(html).toContain("Things you shared with only some people");
    expect(html).toContain("Give each one to the first person you shared it with");
    expect(html).toContain("Delete them");
    expect(html).not.toContain("Birthday dinner");
    world.user = kennyUser;
    await ctx.db.delete(t.memberships).where(eq(t.memberships.userId, USERS.jacob.id));
    expect(await render()).not.toContain("Things you shared with only some people");
  });

  it("does not mention hidden items another person made", async () => {
    const ctx = present(world.ctx);
    await quickAddItem(ctx, TRIP_ID, kenny, { type: "plan", title: "Surprise dinner", city: "Tokyo", startLocal: "2026-12-03T19:00", endLocal: "2026-12-03T21:00" }, { visibility: "only_me" });
    world.user = jacobUser;
    const html = await render();
    expect(html).not.toContain("Surprise dinner");
    expect(html).not.toContain("Things you shared with only some people");
  });

  it("puts no name, email or id in any link", async () => {
    const html = await render();
    const hrefs = [...html.matchAll(/href="([^"]*)"/g)].map((m) => m[1]);
    for (const href of hrefs) {
      expect(href).not.toContain("@");
      expect(href).not.toContain("?");
    }
  });
});
