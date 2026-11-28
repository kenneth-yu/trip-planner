import { eq } from "drizzle-orm";
import { describe, expect, it, vi } from "vitest";
import { buildMirrorEvents } from "@/domain/mirror/calendar-mirror";
import { TRIP_ID, USERS } from "@/fixtures/december-trip";
import { AccessDenied, projectTrip } from "@/domain/visibility/project";
import { present } from "@/testing/present";
import * as t from "../db/schema";
import { describeIdeas } from "../mcp/describe";
import { jacob, kenny, testContext } from "../testing";
import { listActivityLines } from "./activity-service";
import { deleteAccount } from "./deletion-service";
import { createIdea, dropIdea, editIdea, listIdeas, markIdeaDone, markIdeaNotDone, restoreIdea, scheduleIdea } from "./idea-service";
import { getTripView, NotFound } from "./trip-service";

const failing = vi.hoisted(() => ({ scheduling: false }));

vi.mock("../repo/activity-repo", async (importOriginal) => {
  const real = await importOriginal<typeof import("../repo/activity-repo")>();
  return {
    ...real,
    insertActivity: async (...args: Parameters<typeof real.insertActivity>) => {
      if (failing.scheduling && args[1].action === "idea_scheduled") throw new Error("the log could not be written");
      return real.insertActivity(...args);
    },
  };
});

const viewerId = "00000000-0000-4000-8000-0000000000c3";

async function withViewer() {
  const env = await testContext({ withItems: true });
  await env.db.insert(t.users).values({ id: viewerId, email: "mom@example.test", name: "Mom", homeZone: "America/New_York" });
  await env.db.insert(t.memberships).values({ tripId: TRIP_ID, userId: viewerId, role: "viewer" });
  return { ...env, viewer: { kind: "member" as const, userId: viewerId, homeZone: "America/New_York" } };
}

describe("capturing ideas", () => {
  it("makes an idea with a city, and one with a place, that an editor and a viewer both see", async () => {
    const { ctx, viewer } = await withViewer();
    const gold = await createIdea(ctx, TRIP_ID, kenny, { title: "Buy gold", where: "Shenzhen" });
    const spa = await createIdea(ctx, TRIP_ID, kenny, { title: "Massage", where: "Tianyuan Foot Spa, Luohu, Shenzhen", note: "Ask for Ms Lin" });
    expect(gold).toMatchObject({ city: "Shenzhen", location: null, state: "open", createdBy: USERS.kenny.id, visibility: "everyone" });
    expect(spa.location).toMatchObject({ name: "Tianyuan Foot Spa, Luohu, Shenzhen" });
    expect(spa.note).toBe("Ask for Ms Lin");
    for (const who of [kenny, jacob, viewer]) expect((await listIdeas(ctx, TRIP_ID, who)).map((i) => i.title).sort()).toEqual(["Buy gold", "Massage"]);
  });

  it("makes an idea with no place at all, and trims and limits what is typed", async () => {
    const { ctx } = await testContext();
    expect((await createIdea(ctx, TRIP_ID, kenny, { title: "  Try the local beer  " })).title).toBe("Try the local beer");
    await expect(createIdea(ctx, TRIP_ID, kenny, { title: "   " })).rejects.toThrow();
    await expect(createIdea(ctx, TRIP_ID, kenny, { title: "x".repeat(201) })).rejects.toThrow();
    await expect(createIdea(ctx, TRIP_ID, kenny, { title: "ok", note: "x".repeat(2001) })).rejects.toThrow();
  });

  it("is refused to a viewer and to someone who is not on the trip, and nothing is kept", async () => {
    const { ctx, db, viewer } = await withViewer();
    await expect(createIdea(ctx, TRIP_ID, viewer, { title: "Nope" })).rejects.toThrow(AccessDenied);
    await expect(createIdea(ctx, TRIP_ID, { kind: "member", userId: "00000000-0000-4000-8000-0000000000ff", homeZone: "UTC" }, { title: "Nope" })).rejects.toThrow(AccessDenied);
    await expect(createIdea(ctx, TRIP_ID, { kind: "link", homeZone: "UTC" }, { title: "Nope" })).rejects.toThrow(AccessDenied);
    expect(await db.select().from(t.ideas)).toEqual([]);
  });

  it("lets the viewer read the list, and refuses every action to them", async () => {
    const { ctx, viewer } = await withViewer();
    const idea = await createIdea(ctx, TRIP_ID, kenny, { title: "Buy gold", where: "Shenzhen" });
    expect(await listIdeas(ctx, TRIP_ID, viewer)).toHaveLength(1);
    for (const act of [() => editIdea(ctx, TRIP_ID, idea.id, viewer, { title: "x" }), () => markIdeaDone(ctx, TRIP_ID, idea.id, viewer), () => dropIdea(ctx, TRIP_ID, idea.id, viewer)]) {
      await expect(act()).rejects.toThrow(AccessDenied);
    }
    expect((await listIdeas(ctx, TRIP_ID, kenny))[0]?.state).toBe("open");
  });
});

describe("who sees which idea", () => {
  it("keeps an only me idea from everyone else, in the list and in the assistant's text", async () => {
    const { ctx, viewer } = await withViewer();
    await createIdea(ctx, TRIP_ID, jacob, { title: "Surprise for Kenneth", visibility: "only_me", note: "ring" });
    await createIdea(ctx, TRIP_ID, kenny, { title: "Buy gold", where: "Shenzhen" });
    expect((await listIdeas(ctx, TRIP_ID, jacob)).map((i) => i.title).sort()).toEqual(["Buy gold", "Surprise for Kenneth"]);
    for (const who of [kenny, viewer]) {
      const seen = await listIdeas(ctx, TRIP_ID, who);
      expect(seen.map((i) => i.title)).toEqual(["Buy gold"]);
      expect(JSON.stringify(seen) + describeIdeas(seen)).not.toMatch(/Surprise|ring/);
    }
  });

  it("shows a specific idea only to the people chosen, who must be on the trip", async () => {
    const { ctx, viewer } = await withViewer();
    await createIdea(ctx, TRIP_ID, kenny, { title: "Dinner with Mom", visibility: "specific", visibleToUserIds: [viewerId] });
    expect((await listIdeas(ctx, TRIP_ID, viewer)).map((i) => i.title)).toEqual(["Dinner with Mom"]);
    expect(await listIdeas(ctx, TRIP_ID, jacob)).toEqual([]);
    await expect(createIdea(ctx, TRIP_ID, kenny, { title: "x", visibility: "specific", visibleToUserIds: ["00000000-0000-4000-8000-0000000000ee"] })).rejects.toThrow();
  });

  it("lets only the person who added an idea change who sees it, and says an unseen idea does not exist", async () => {
    const { ctx } = await testContext();
    const idea = await createIdea(ctx, TRIP_ID, kenny, { title: "Buy gold" });
    await expect(editIdea(ctx, TRIP_ID, idea.id, jacob, { title: "Buy gold", visibility: "only_me" })).rejects.toThrow(AccessDenied);
    expect((await editIdea(ctx, TRIP_ID, idea.id, jacob, { title: "Buy gold and silver" })).title).toBe("Buy gold and silver");
    await editIdea(ctx, TRIP_ID, idea.id, kenny, { title: "Buy gold and silver", visibility: "only_me" });
    await expect(editIdea(ctx, TRIP_ID, idea.id, jacob, { title: "x" })).rejects.toThrow(NotFound);
    await expect(markIdeaDone(ctx, TRIP_ID, idea.id, jacob)).rejects.toThrow(NotFound);
  });

  it("does not find an idea of another trip, or one that is not an id", async () => {
    const { ctx } = await testContext();
    const idea = await createIdea(ctx, TRIP_ID, kenny, { title: "Buy gold" });
    await expect(editIdea(ctx, "00000000-0000-4000-8300-0000000000aa", idea.id, kenny, { title: "x" })).rejects.toThrow();
    await expect(markIdeaDone(ctx, TRIP_ID, "../x", kenny)).rejects.toThrow(NotFound);
  });
});

describe("did it, not done, drop it and undo", () => {
  it("moves an idea to done with who and when, back to open, and a dropped one is listed nowhere until restored", async () => {
    const { ctx } = await testContext();
    const idea = await createIdea(ctx, TRIP_ID, kenny, { title: "Buy gold", where: "Shenzhen" });
    const done = await markIdeaDone(ctx, TRIP_ID, idea.id, jacob);
    expect(done).toMatchObject({ state: "done", doneBy: USERS.jacob.id });
    expect(done.doneAt).toBe(ctx.now().toISOString());
    expect((await markIdeaNotDone(ctx, TRIP_ID, idea.id, kenny)).doneBy).toBeNull();
    await dropIdea(ctx, TRIP_ID, idea.id, kenny);
    expect(await listIdeas(ctx, TRIP_ID, kenny)).toEqual([]);
    expect((await restoreIdea(ctx, TRIP_ID, idea.id, kenny)).state).toBe("open");
    expect(await listIdeas(ctx, TRIP_ID, kenny)).toHaveLength(1);
  });

  it("says it already changed when two people act on the same idea", async () => {
    const { ctx } = await testContext();
    const idea = await createIdea(ctx, TRIP_ID, kenny, { title: "Buy gold" });
    await markIdeaDone(ctx, TRIP_ID, idea.id, kenny);
    await expect(markIdeaDone(ctx, TRIP_ID, idea.id, jacob)).rejects.toThrow("That idea already changed. Reload the page.");
    await expect(dropIdea(ctx, TRIP_ID, idea.id, jacob)).rejects.toThrow("That idea already changed.");
  });
});

describe("scheduling an idea", () => {
  const plan = { type: "plan", title: "Buy gold", city: "Shenzhen", startLocal: "2026-12-08T14:00", endLocal: "2026-12-08T15:00" };

  it("makes the plan and removes the idea in one step, and the plan follows the idea's sharing", async () => {
    const { ctx, db } = await testContext({ withItems: false });
    const idea = await createIdea(ctx, TRIP_ID, kenny, { title: "Buy gold", where: "Shenzhen", visibility: "only_me" });
    const item = await scheduleIdea(ctx, TRIP_ID, idea.id, kenny, plan);
    expect(item).toMatchObject({ title: "Buy gold", visibility: "only_me", createdBy: USERS.kenny.id });
    expect(await db.select().from(t.ideas)).toEqual([]);
    expect((await getTripView(ctx, TRIP_ID, kenny)).items.map((i) => i.title)).toEqual(["Buy gold"]);
  });

  it("makes the plan once when it is tried twice, and leaves the idea gone", async () => {
    const { ctx, db } = await testContext({ withItems: false });
    const idea = await createIdea(ctx, TRIP_ID, kenny, { title: "Buy gold", where: "Shenzhen" });
    await scheduleIdea(ctx, TRIP_ID, idea.id, kenny, plan);
    await db.insert(t.ideas).values({ id: idea.id, tripId: TRIP_ID, title: "Buy gold", createdBy: USERS.kenny.id });
    await scheduleIdea(ctx, TRIP_ID, idea.id, kenny, plan);
    expect((await getTripView(ctx, TRIP_ID, kenny)).items).toHaveLength(1);
    expect(await db.select().from(t.ideas)).toEqual([]);
  });

  it("is all or nothing: when the log cannot be written there is no plan and the idea is still open", async () => {
    const { ctx, db } = await testContext({ withItems: false });
    const idea = await createIdea(ctx, TRIP_ID, kenny, { title: "Buy gold", where: "Shenzhen" });
    failing.scheduling = true;
    try {
      await expect(scheduleIdea(ctx, TRIP_ID, idea.id, kenny, plan)).rejects.toThrow("the log could not be written");
    } finally {
      failing.scheduling = false;
    }
    expect((await getTripView(ctx, TRIP_ID, kenny)).items).toEqual([]);
    expect((await db.select().from(t.ideas)).map((i) => [i.title, i.state])).toEqual([["Buy gold", "open"]]);
  });

  it("is refused for a viewer, for a done idea, and for a plan that is not valid, keeping the idea", async () => {
    const { ctx, db, viewer } = await withViewer();
    const idea = await createIdea(ctx, TRIP_ID, kenny, { title: "Buy gold" });
    await expect(scheduleIdea(ctx, TRIP_ID, idea.id, viewer, plan)).rejects.toThrow(AccessDenied);
    await expect(scheduleIdea(ctx, TRIP_ID, idea.id, kenny, { type: "plan" })).rejects.toThrow();
    expect(await db.select().from(t.ideas)).toHaveLength(1);
    await markIdeaDone(ctx, TRIP_ID, idea.id, kenny);
    await expect(scheduleIdea(ctx, TRIP_ID, idea.id, kenny, plan)).rejects.toThrow("already changed");
  });
});

describe("the activity log", () => {
  const lines = async (ctx: Awaited<ReturnType<typeof testContext>>["ctx"], who: typeof kenny) => (await listActivityLines(ctx, TRIP_ID, who)).lines.filter((l) => l.kind.startsWith("idea_")).map((l) => `${l.by} ${l.kind} ${l.title}`);

  it("says who scheduled, did, dropped and brought back an idea, and agrees with undo: bringing it back is its own line", async () => {
    const { ctx } = await testContext({ withItems: false });
    const gold = await createIdea(ctx, TRIP_ID, kenny, { title: "Buy gold", where: "Shenzhen" });
    const spa = await createIdea(ctx, TRIP_ID, kenny, { title: "Massage" });
    await markIdeaDone(ctx, TRIP_ID, gold.id, jacob);
    await markIdeaNotDone(ctx, TRIP_ID, gold.id, jacob);
    await dropIdea(ctx, TRIP_ID, spa.id, kenny);
    await restoreIdea(ctx, TRIP_ID, spa.id, kenny);
    await scheduleIdea(ctx, TRIP_ID, gold.id, kenny, { type: "plan", title: "Buy gold", city: "Shenzhen", startLocal: "2026-12-08T14:00", endLocal: "2026-12-08T15:00" });
    expect((await lines(ctx, kenny)).sort()).toEqual(["Jacob idea_done Buy gold", "Jacob idea_reopened Buy gold", "You idea_dropped Massage", "You idea_reopened Massage", "You idea_scheduled Buy gold"].sort());
  });

  it("leaves another person's hidden idea out of the log, and shows it to the people who may see it", async () => {
    const { ctx } = await testContext({ withItems: false });
    const secret = await createIdea(ctx, TRIP_ID, jacob, { title: "Surprise", visibility: "only_me" });
    await markIdeaDone(ctx, TRIP_ID, secret.id, jacob);
    expect(await lines(ctx, kenny)).toEqual([]);
    expect(await lines(ctx, jacob)).toEqual(["You idea_done Surprise"]);
  });
});

describe("ideas stay inside the app", () => {
  it("are in no mirror event and no view link, but do reach get_trip's ideas", async () => {
    const { ctx } = await testContext();
    await createIdea(ctx, TRIP_ID, kenny, { title: "Buy gold IDEA-MARK", where: "Shenzhen", note: "NOTE-MARK" });
    const view = await getTripView(ctx, TRIP_ID, kenny);
    const asText = (value: unknown) => JSON.stringify(value);
    expect(asText(buildMirrorEvents(view, { includeSensitive: true, appUrl: "https://trips.test" }))).not.toMatch(/IDEA-MARK|NOTE-MARK/);
    expect(asText(projectTrip(present(await import("./trip-service").then((m) => m.requireAggregate(ctx.db, TRIP_ID))), { kind: "link", homeZone: "UTC" }))).not.toMatch(/IDEA-MARK|NOTE-MARK/);
    expect(describeIdeas(await listIdeas(ctx, TRIP_ID, kenny))).toContain("- Buy gold IDEA-MARK (Shenzhen): NOTE-MARK");
  });
});

describe("deleting an account", () => {
  async function setup() {
    const env = await withViewer();
    await env.db.insert(t.users).values({ id: "00000000-0000-4000-8000-0000000000c4", email: "dad@example.test", name: "Dad", homeZone: "America/New_York" });
    await env.db.insert(t.memberships).values({ tripId: TRIP_ID, userId: "00000000-0000-4000-8000-0000000000c4", role: "editor" });
    return env;
  }
  const dad = "00000000-0000-4000-8000-0000000000c4";
  const rows = async (db: Awaited<ReturnType<typeof setup>>["db"]) => (await db.select().from(t.ideas)).map((i) => ({ title: i.title, createdBy: i.createdBy, visibility: i.visibility, visibleTo: i.visibleToUserIds })).sort((a, b) => a.title.localeCompare(b.title));

  it("deletes the person's only me ideas and hands specific ones to the first person left on the list", async () => {
    const { ctx, db } = await setup();
    await createIdea(ctx, TRIP_ID, jacob, { title: "Only mine", visibility: "only_me" });
    await createIdea(ctx, TRIP_ID, jacob, { title: "For Mom and Dad", visibility: "specific", visibleToUserIds: [viewerId, dad] });
    await createIdea(ctx, TRIP_ID, jacob, { title: "Just for Kenneth", visibility: "specific", visibleToUserIds: [USERS.kenny.id] });
    expect(await deleteAccount(ctx, USERS.jacob.id, { removeHiddenItemsInSharedTrips: false })).toEqual({ blockedBy: [] });
    expect(await rows(db)).toEqual([
      { title: "For Mom and Dad", createdBy: viewerId, visibility: "specific", visibleTo: [dad] },
      { title: "Just for Kenneth", createdBy: USERS.kenny.id, visibility: "specific", visibleTo: [] },
    ]);
  });

  it("deletes a specific idea when nobody else on its list is left on the trip", async () => {
    const { ctx, db } = await setup();
    await createIdea(ctx, TRIP_ID, jacob, { title: "For Mom", visibility: "specific", visibleToUserIds: [viewerId] });
    await db.delete(t.memberships).where(eq(t.memberships.userId, viewerId));
    await deleteAccount(ctx, USERS.jacob.id, { removeHiddenItemsInSharedTrips: false });
    expect(await rows(db)).toEqual([]);
  });

  it("deletes every hidden idea when the person chose to remove them, and keeps ideas for everyone with no creator, visible to everyone", async () => {
    const { ctx, db } = await setup();
    await createIdea(ctx, TRIP_ID, jacob, { title: "For Dad", visibility: "specific", visibleToUserIds: [dad] });
    await createIdea(ctx, TRIP_ID, jacob, { title: "For everyone" });
    await deleteAccount(ctx, USERS.jacob.id, { removeHiddenItemsInSharedTrips: true });
    expect(await rows(db)).toEqual([{ title: "For everyone", createdBy: null, visibility: "everyone", visibleTo: [] }]);
    expect((await listIdeas(ctx, TRIP_ID, kenny)).map((i) => i.title)).toEqual(["For everyone"]);
  });

  it("strips the deleted person from every list, and never leaves an idea visible to nobody-owned strangers", async () => {
    const { ctx, db } = await setup();
    await createIdea(ctx, TRIP_ID, kenny, { title: "Kenneth's with Jacob", visibility: "specific", visibleToUserIds: [USERS.jacob.id, dad] });
    await deleteAccount(ctx, USERS.jacob.id, { removeHiddenItemsInSharedTrips: false });
    expect(await rows(db)).toEqual([{ title: "Kenneth's with Jacob", createdBy: USERS.kenny.id, visibility: "specific", visibleTo: [dad] }]);
  });

  it("shows an only me idea whose creator is gone to nobody, even if one slips through", async () => {
    const { ctx, db, viewer } = await setup();
    await db.insert(t.ideas).values({ tripId: TRIP_ID, title: "Orphan", visibility: "only_me", createdBy: null });
    await db.insert(t.ideas).values({ tripId: TRIP_ID, title: "Orphan list", visibility: "specific", visibleToUserIds: [], createdBy: null });
    for (const who of [kenny, jacob, viewer]) expect(await listIdeas(ctx, TRIP_ID, who)).toEqual([]);
  });

  it("deletes the ideas of a trip with the trip", async () => {
    const { ctx, db } = await testContext();
    await createIdea(ctx, TRIP_ID, kenny, { title: "Buy gold" });
    const { deleteTrip } = await import("./deletion-service");
    await deleteTrip(ctx, TRIP_ID, kenny);
    expect(await db.select().from(t.ideas)).toEqual([]);
  });
});
