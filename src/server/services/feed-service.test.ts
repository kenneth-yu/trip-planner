import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { buildFixtureTrip, TRIP_ID, USERS } from "@/fixtures/december-trip";
import { InvalidTransition } from "@/domain/state/machine";
import { AccessDenied } from "@/domain/visibility/project";
import { present } from "@/testing/present";
import * as t from "../db/schema";
import { jacob, kenny, testContext } from "../testing";
import { FeedLinkExists, getFeedLink, loadFeed, makeFeedLink, rotateFeedLink, turnOffFeedLink } from "./feed-service";

const tokenOf = (url: string) => present(url.match(/\/api\/feed\/(tpf_[A-Za-z0-9_-]{43})\.ics$/)?.[1], url);
const outsider = { kind: "member" as const, userId: "00000000-0000-4000-8000-0000000000ff", homeZone: "America/New_York" };
const sensitive = buildFixtureTrip().items.flatMap((item) => item.private.flatMap((p) => [p.confirmationCode, p.seat, p.phone, p.price?.amount, p.bookingReference].filter((v): v is string => typeof v === "string" && v.length > 0)));

describe("a member's calendar link", () => {
  it("is made once, shown once as a link, and stored only as a hash", async () => {
    const { ctx, db } = await testContext();
    const { url } = await makeFeedLink(ctx, TRIP_ID, jacob);
    const token = tokenOf(url);
    expect(url).toBe(`https://trips.test/api/feed/${token}.ics`);
    const rows = await db.select().from(t.calendarFeeds);
    expect(rows).toHaveLength(1);
    expect(JSON.stringify(rows)).not.toContain(token);
    expect(rows[0]?.userId).toBe(USERS.jacob.id);
    expect(await getFeedLink(ctx, TRIP_ID, jacob)).toMatchObject({ lastReadAt: null });
  });

  it("is made once when two requests arrive together: one wins, one is told a link exists, and only one link is active", async () => {
    const { ctx, db } = await testContext();
    const results = await Promise.allSettled([makeFeedLink(ctx, TRIP_ID, jacob), makeFeedLink(ctx, TRIP_ID, jacob), makeFeedLink(ctx, TRIP_ID, jacob)]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    for (const r of results) if (r.status === "rejected") expect(r.reason).toBeInstanceOf(FeedLinkExists);
    expect((await db.select().from(t.calendarFeeds)).filter((row) => row.revokedAt === null)).toHaveLength(1);
  });

  it("keeps one active link when two new links are made together", async () => {
    const { ctx, db } = await testContext();
    await makeFeedLink(ctx, TRIP_ID, jacob);
    await Promise.allSettled([rotateFeedLink(ctx, TRIP_ID, jacob), rotateFeedLink(ctx, TRIP_ID, jacob)]);
    expect((await db.select().from(t.calendarFeeds)).filter((row) => row.revokedAt === null)).toHaveLength(1);
  });

  it("is not made twice: a second link is a new link, which breaks the first", async () => {
    const { ctx } = await testContext();
    await makeFeedLink(ctx, TRIP_ID, jacob);
    await expect(makeFeedLink(ctx, TRIP_ID, jacob)).rejects.toThrow(FeedLinkExists);
  });

  it("is the trip as that member sees it, without a code, seat, phone or price", async () => {
    const { ctx } = await testContext();
    const feed = present(await loadFeed(ctx, tokenOf((await makeFeedLink(ctx, TRIP_ID, jacob)).url)));
    expect(feed).toContain("SUMMARY:NH159 to Tokyo\r\n");
    expect(feed).toContain("DTSTART;TZID=America/New_York:20261201T005500\r\n");
    expect(sensitive.length).toBeGreaterThan(3);
    for (const value of sensitive) expect(feed.replace(/\r\n /g, "")).not.toContain(value);
  });

  it("belongs to one person: a hidden plan shows to its owner in full and to the other only as Busy", async () => {
    const { ctx, db } = await testContext();
    const [plan] = await db.select().from(t.items).where(eq(t.items.title, "Head spa, Belle Cheveu Hiroo"));
    await db.update(t.items).set({ visibility: "only_me", showAsBusy: true, createdBy: USERS.jacob.id }).where(eq(t.items.id, present(plan).id));
    const mine = present(await loadFeed(ctx, tokenOf((await makeFeedLink(ctx, TRIP_ID, jacob)).url))).replace(/\r\n /g, "");
    const theirs = present(await loadFeed(ctx, tokenOf((await makeFeedLink(ctx, TRIP_ID, kenny)).url))).replace(/\r\n /g, "");
    expect(mine).toContain("Head spa");
    expect(theirs).not.toContain("Head spa");
    expect(theirs).toContain("SUMMARY:Busy\r\n");
  });

  it("leaves out deadlines for a viewer who may not see them, and puts them in when the owner allows it", async () => {
    const { ctx, db } = await testContext();
    await db.update(t.memberships).set({ role: "viewer" }).where(eq(t.memberships.userId, USERS.jacob.id));
    const token = tokenOf((await makeFeedLink(ctx, TRIP_ID, jacob)).url);
    expect(present(await loadFeed(ctx, token))).not.toContain("non refundable");
    await db.update(t.trips).set({ viewersSeeDeadlines: true }).where(eq(t.trips.id, TRIP_ID));
    expect(present(await loadFeed(ctx, token))).toContain("non refundable");
  });

  it("is not made by someone who is not on the trip, and nothing is kept", async () => {
    const { ctx, db } = await testContext();
    await expect(makeFeedLink(ctx, TRIP_ID, outsider)).rejects.toThrow(AccessDenied);
    await expect(makeFeedLink(ctx, TRIP_ID, { kind: "link", homeZone: "UTC" })).rejects.toThrow(AccessDenied);
    await expect(getFeedLink(ctx, TRIP_ID, outsider)).rejects.toThrow(AccessDenied);
    expect(await db.select().from(t.calendarFeeds)).toEqual([]);
  });

  it("stops working at once when the person is removed from the trip", async () => {
    const { ctx, db } = await testContext();
    const token = tokenOf((await makeFeedLink(ctx, TRIP_ID, jacob)).url);
    expect(await loadFeed(ctx, token)).not.toBeNull();
    await db.delete(t.memberships).where(eq(t.memberships.userId, USERS.jacob.id));
    expect(await loadFeed(ctx, token)).toBeNull();
  });
});

describe("making a new link and turning it off", () => {
  it("makes a new link that works while the old one stops at once", async () => {
    const { ctx, db } = await testContext();
    const first = tokenOf((await makeFeedLink(ctx, TRIP_ID, jacob)).url);
    const second = tokenOf((await rotateFeedLink(ctx, TRIP_ID, jacob)).url);
    expect(second).not.toBe(first);
    expect(await loadFeed(ctx, first)).toBeNull();
    expect(await loadFeed(ctx, second)).not.toBeNull();
    expect((await db.select().from(t.calendarFeeds)).filter((r) => r.revokedAt === null)).toHaveLength(1);
  });

  it("turns off, so the link fails, and a new one can then be made", async () => {
    const { ctx } = await testContext();
    const token = tokenOf((await makeFeedLink(ctx, TRIP_ID, jacob)).url);
    await turnOffFeedLink(ctx, TRIP_ID, jacob);
    expect(await loadFeed(ctx, token)).toBeNull();
    expect(await getFeedLink(ctx, TRIP_ID, jacob)).toBeNull();
    const again = tokenOf((await makeFeedLink(ctx, TRIP_ID, jacob)).url);
    expect(await loadFeed(ctx, again)).not.toBeNull();
  });

  it("refuses to rotate or turn off when there is no link", async () => {
    const { ctx } = await testContext();
    await expect(rotateFeedLink(ctx, TRIP_ID, jacob)).rejects.toThrow(InvalidTransition);
    await expect(turnOffFeedLink(ctx, TRIP_ID, jacob)).rejects.toThrow(InvalidTransition);
  });

  it("changes only the caller's link, never another member's", async () => {
    const { ctx } = await testContext();
    const theirs = tokenOf((await makeFeedLink(ctx, TRIP_ID, kenny)).url);
    await makeFeedLink(ctx, TRIP_ID, jacob);
    await rotateFeedLink(ctx, TRIP_ID, jacob);
    await turnOffFeedLink(ctx, TRIP_ID, jacob);
    expect(await loadFeed(ctx, theirs)).not.toBeNull();
  });
});

describe("reading the feed", () => {
  it.each(["", "abc", "tpf_short", `tpf_${"a".repeat(44)}`, `tpv_${"a".repeat(43)}`, `tpf_${"a".repeat(43)}`])("finds nothing for the token %j", async (token) => {
    const { ctx } = await testContext();
    expect(await loadFeed(ctx, token)).toBeNull();
  });

  it("notes when a calendar app last read it, at most every five minutes", async () => {
    const { ctx, db } = await testContext();
    const token = tokenOf((await makeFeedLink(ctx, TRIP_ID, jacob)).url);
    expect((await getFeedLink(ctx, TRIP_ID, jacob))?.lastReadAt).toBeNull();
    await loadFeed(ctx, token);
    const first = present((await getFeedLink(ctx, TRIP_ID, jacob))?.lastReadAt);
    expect(first.getTime()).toBe(ctx.now().getTime());
    const later = { ...ctx, now: () => new Date(ctx.now().getTime() + 2 * 60_000) };
    await loadFeed(later, token);
    expect(present((await getFeedLink(ctx, TRIP_ID, jacob))?.lastReadAt).getTime()).toBe(first.getTime());
    const muchLater = { ...ctx, now: () => new Date(ctx.now().getTime() + 6 * 60_000) };
    await loadFeed(muchLater, token);
    expect(present((await getFeedLink(ctx, TRIP_ID, jacob))?.lastReadAt).getTime()).toBe(muchLater.now().getTime());
    expect(await db.select().from(t.calendarFeeds)).toHaveLength(1);
  });

  it("does not note a read that finds nothing", async () => {
    const { ctx } = await testContext();
    const token = tokenOf((await makeFeedLink(ctx, TRIP_ID, jacob)).url);
    await turnOffFeedLink(ctx, TRIP_ID, jacob);
    await loadFeed(ctx, token);
    expect(await getFeedLink(ctx, TRIP_ID, jacob)).toBeNull();
  });
});
