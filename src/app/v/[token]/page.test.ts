import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { TRIP_ID, USERS } from "@/fixtures/december-trip";
import { present } from "@/testing/present";
import { jacob, kenny, testContext } from "@/server/testing";
import type { ServiceContext } from "@/server/services/context";
import { quickAddItem } from "@/server/services/trip-service";
import { disableViewLink, enableViewLink, rotateViewLink, setLinkShowsDeadlines } from "@/server/services/view-link-service";
import * as t from "@/server/db/schema";
import { eq } from "drizzle-orm";
import VisitorPage from "./page";

const world = vi.hoisted(() => {
  const state: { ctx: ServiceContext | null; cookies: Record<string, string>; inboxReads: number } = { ctx: null, cookies: {}, inboxReads: 0 };
  return state;
});

vi.mock("next/headers", () => ({
  cookies: async () => ({ get: (name: string) => (name in world.cookies ? { name, value: world.cookies[name] } : undefined) }),
}));
vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new Error("NEXT_NOT_FOUND");
  },
  useRouter: () => ({ refresh: () => undefined }),
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock("@/server/app-context", () => ({
  requestContext: async () => {
    if (!world.ctx) throw new Error("no test context");
    return world.ctx;
  },
}));
vi.mock("@/server/services/inbox-service", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/server/services/inbox-service")>();
  return {
    ...actual,
    listInbox: (...args: Parameters<typeof actual.listInbox>) => {
      world.inboxReads += 1;
      return actual.listInbox(...args);
    },
    disagreementFindings: (...args: Parameters<typeof actual.disagreementFindings>) => {
      world.inboxReads += 1;
      return actual.disagreementFindings(...args);
    },
  };
});

const tokenOf = (url: string) => url.slice(url.lastIndexOf("/") + 1);

async function render(token: string, search: Record<string, string> = {}): Promise<string> {
  const element = (await VisitorPage({ params: Promise.resolve({ token }), searchParams: Promise.resolve(search) }));
  return renderToStaticMarkup(createElement(() => element));
}

async function visible(token: string, search: Record<string, string> = {}): Promise<string | "not found"> {
  try {
    return await render(token, search);
  } catch (e) {
    if (e instanceof Error && e.message === "NEXT_NOT_FOUND") return "not found";
    throw e;
  }
}

beforeEach(async () => {
  vi.stubEnv("SESSION_SECRET", "test-secret-test-secret-test-secret-0123");
  const env = await testContext();
  await env.db.delete(t.shareLinks).where(eq(t.shareLinks.tripId, TRIP_ID));
  await quickAddItem(env.ctx, TRIP_ID, jacob, { type: "plan", title: "Ring shopping", city: "Hong Kong", startLocal: "2026-12-05T20:00", endLocal: "2026-12-05T21:00" }, { visibility: "only_me", showAsBusy: true });
  world.ctx = env.ctx;
  world.cookies = {};
  world.inboxReads = 0;
});

async function linkToken(): Promise<string> {
  return tokenOf((await enableViewLink(present(world.ctx), TRIP_ID, kenny)).url);
}

describe("the visitor page", () => {
  it("opens on where they are, with up next and the day, and nothing for members", async () => {
    const token = await linkToken();
    const html = await render(token);
    expect(html).toMatch(/They leave in [45] days\./);
    expect(html).toContain("Up next");
    expect(html).toContain("NH159");
    for (const absent of ["Add flight", "Inbox", "Connect", "Share", "Sign in", "Worth a look", "Busy", "Ring shopping", "Decisions"]) {
      expect(html).not.toContain(absent);
    }
    expect(html).not.toContain("/trips/");
  });

  it("carries no code, seat, phone, price, user id, email or hidden item anywhere in the HTML", async () => {
    const html = await render(await linkToken());
    for (const secret of ["PLACEHOLDER_", "30K", "30C", USERS.kenny.id, USERS.jacob.id, USERS.kenny.email, USERS.jacob.email, "Ring shopping", "Feldman", "Kenneth Yu"]) {
      expect(html).not.toContain(secret);
    }
  });

  it("shows a Decisions section only when the link switch is on, without the warning color", async () => {
    const token = await linkToken();
    expect(await render(token)).not.toContain("Decisions");
    await setLinkShowsDeadlines(present(world.ctx), TRIP_ID, kenny, true);
    const html = await render(token);
    expect(html).toContain("Decisions");
    expect(html).toContain("Hotel Resol Ueno");
    expect(html).not.toMatch(/warning/i);
    expect(world.inboxReads).toBe(0);
  });

  it("never reads the inbox or disagreement findings, with deadlines on or off", async () => {
    const token = await linkToken();
    await setLinkShowsDeadlines(present(world.ctx), TRIP_ID, kenny, true);
    await render(token);
    await render(token, { view: "grid" });
    expect(world.inboxReads).toBe(0);
  });

  it("uses the visitor's zone hint and falls back quietly on junk", async () => {
    const token = await linkToken();
    world.cookies = { tp_zone: "Europe/London" };
    expect(await render(token)).toMatch(/They leave in [45] days\./);
    world.cookies = { tp_zone: "<script>alert(1)</script>".repeat(30) };
    const html = await render(token);
    expect(html).toMatch(/They leave in [45] days\./);
    expect(html).not.toContain("<script>alert");
  });

  it("never says your time before the visitor's zone is known, and says it once it is", async () => {
    const token = await linkToken();
    expect(await render(token)).not.toContain("your time");
    world.cookies = { tp_zone: "Europe/London" };
    expect(await render(token)).toContain("your time");
    world.cookies = { tp_zone: "Mars/Olympus" };
    expect(await render(token)).not.toContain("your time");
  });

  it("the whole-trip view shows the same projection, with no check bubbles and no links into the trip", async () => {
    const token = await linkToken();
    const html = await render(token, { view: "grid" });
    expect(html).toContain("Back to now");
    expect(html).not.toContain("No way to");
    expect(html).not.toContain("Ring shopping");
    expect(html).not.toContain("/trips/");
    expect(await render(token, { view: "nonsense", day: "<b>x</b>" })).toContain("See the whole trip");
  });

  it("gives a turned off, rotated, unknown and malformed link the same not found answer", async () => {
    const ctx = present(world.ctx);
    const first = await linkToken();
    const second = tokenOf((await rotateViewLink(ctx, TRIP_ID, kenny)).url);
    expect(await visible(first)).toBe("not found");
    expect(await visible(second)).not.toBe("not found");
    await disableViewLink(ctx, TRIP_ID, kenny);
    const answers = await Promise.all([second, `tpv_${"B".repeat(43)}`, "junk", "tpv_"].map((token) => visible(token)));
    expect(new Set(answers)).toEqual(new Set(["not found"]));
  });

  it("says nothing is planned on an empty trip", async () => {
    const ctx = present(world.ctx);
    const token = await linkToken();
    await ctx.db.delete(t.items).where(eq(t.items.tripId, TRIP_ID));
    expect(await render(token)).toContain("Nothing planned yet.");
  });
});
