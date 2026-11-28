import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { TRIP_ID, USERS } from "@/fixtures/december-trip";
import { jacob, testContext } from "@/server/testing";
import type { ServiceContext } from "@/server/services/context";
import { getFeedLink } from "@/server/services/feed-service";
import { calendarLinkAction } from "./calendar-link-actions";
import { CalendarLink } from "./calendar-link";
import { agoText, lastReadText, noCalendarLink, subscribeUrl } from "./calendar-link-text";

const world = vi.hoisted(() => {
  const state: { ctx: ServiceContext | null } = { ctx: null };
  return state;
});

vi.mock("next/cache", () => ({ revalidatePath: () => undefined }));
vi.mock("@/server/web", () => ({
  loadTripPage: async () => {
    if (!world.ctx) throw new Error("no test context");
    return { ctx: world.ctx, requester: { kind: "member", userId: USERS.jacob.id, homeZone: "America/New_York" }, user: { id: USERS.jacob.id } };
  },
}));

beforeAll(() => {
  process.env.SESSION_SECRET = "test-secret-test-secret-test-secret-0123";
});

beforeEach(async () => {
  world.ctx = (await testContext()).ctx;
});

const form = (intent: string) => {
  const data = new FormData();
  data.set("tripId", TRIP_ID);
  data.set("intent", intent);
  return data;
};

describe("the words about when a calendar app last read the feed", () => {
  it.each([
    [0, "just now"],
    [59_000, "just now"],
    [60_000, "1 minute ago"],
    [119 * 60_000, "1 hour ago"],
    [2 * 3_600_000, "2 hours ago"],
    [23 * 3_600_000, "23 hours ago"],
    [24 * 3_600_000, "1 day ago"],
    [3 * 86_400_000, "3 days ago"],
  ])("%d ms is %j", (elapsed, text) => {
    expect(agoText(elapsed)).toBe(text);
  });

  it("says a calendar app has not read it yet when none has", () => {
    const now = new Date("2026-11-28T12:00:00Z");
    expect(lastReadText(null, now)).toBe("Not read by a calendar app yet.");
    expect(lastReadText(new Date("2026-11-28T10:00:00Z"), now)).toBe("Last read by a calendar app 2 hours ago.");
    expect(lastReadText(new Date("2026-11-28T13:00:00Z"), now)).toBe("Last read by a calendar app just now.");
  });

  it("opens the subscribe dialog through webcal", () => {
    expect(subscribeUrl("https://trips.test/api/feed/tpf_x.ics")).toBe("webcal://trips.test/api/feed/tpf_x.ics");
  });
});

describe("the Connect section", () => {
  const render = (status: { madeOn: string; lastRead: string } | null) => renderToStaticMarkup(createElement(CalendarLink, { tripId: TRIP_ID, status }));

  it("offers a link before one exists, in the spec's words", () => {
    const html = render(null);
    expect(html).toContain("See this trip in Apple Calendar, Outlook or any calendar app that subscribes to links. It updates on its own, usually within a few hours.");
    expect(html).toContain("Codes, seats and prices are never in it. If you already mirror the trip to Google Calendar, you do not need this too.");
    expect(html).toContain("Make a calendar link</button>");
  });

  it("never shows the link again once it was made: when it exists it says when, and when it was last read", () => {
    const html = render({ madeOn: "Nov 28", lastRead: "Not read by a calendar app yet." });
    expect(html).toContain("Calendar link made Nov 28.");
    expect(html).toContain("Not read by a calendar app yet.");
    expect(html).toContain("Make a new link</button>");
    expect(html).toContain("Turn off</button>");
    expect(html).not.toMatch(/tpf_|\/api\/feed/);
  });
});

describe("the actions behind it", () => {
  it("makes a link, shown once, and the page's status then knows it exists", async () => {
    const state = await calendarLinkAction(noCalendarLink, form("make"));
    expect(state.url).toMatch(/^https:\/\/trips\.test\/api\/feed\/tpf_[A-Za-z0-9_-]{43}\.ics$/);
    expect(state.error).toBeNull();
    if (!world.ctx) throw new Error("no test context");
    expect(await getFeedLink(world.ctx, TRIP_ID, jacob)).not.toBeNull();
  });

  it("says it already changed, instead of making a second link, when one exists", async () => {
    await calendarLinkAction(noCalendarLink, form("make"));
    expect(await calendarLinkAction(noCalendarLink, form("make"))).toEqual({ url: null, turnedOff: false, error: "That already changed. Reload the page." });
  });

  it("makes a new link, which is a different one, and turns the link off", async () => {
    const first = await calendarLinkAction(noCalendarLink, form("make"));
    const second = await calendarLinkAction(noCalendarLink, form("rotate"));
    expect(second.url).not.toBe(first.url);
    expect(await calendarLinkAction(noCalendarLink, form("off"))).toEqual({ url: null, turnedOff: true, error: null });
    if (!world.ctx) throw new Error("no test context");
    expect(await getFeedLink(world.ctx, TRIP_ID, jacob)).toBeNull();
  });

  it("says it already changed when there is no link to rotate or turn off", async () => {
    expect((await calendarLinkAction(noCalendarLink, form("rotate"))).error).toBe("That already changed. Reload the page.");
    expect((await calendarLinkAction(noCalendarLink, form("off"))).error).toBe("That already changed. Reload the page.");
  });

  it("refuses an intent it does not know, and a trip id that is not an id", async () => {
    await expect(calendarLinkAction(noCalendarLink, form("delete"))).rejects.toThrow();
    const bad = form("make");
    bad.set("tripId", "../x");
    await expect(calendarLinkAction(noCalendarLink, bad)).rejects.toThrow();
  });
});
