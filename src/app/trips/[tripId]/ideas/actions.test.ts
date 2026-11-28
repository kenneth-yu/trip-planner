import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { TRIP_ID, USERS } from "@/fixtures/december-trip";
import * as t from "@/server/db/schema";
import { jacob, kenny, testContext } from "@/server/testing";
import type { ServiceContext } from "@/server/services/context";
import { listIdeas } from "@/server/services/idea-service";
import { getTripView } from "@/server/services/trip-service";
import { ideaAction, type IdeaState } from "./actions";

const world = vi.hoisted(() => {
  const state: { ctx: ServiceContext | null } = { ctx: null };
  return state;
});

vi.mock("next/cache", () => ({ revalidatePath: () => undefined }));
vi.mock("@/server/web", () => ({
  loadTripPage: async () => {
    if (!world.ctx) throw new Error("no test context");
    return { ctx: world.ctx, requester: kenny, view: await getTripView(world.ctx, TRIP_ID, kenny) };
  },
}));

beforeAll(() => {
  process.env.SESSION_SECRET = "test-secret-test-secret-test-secret-0123";
});

beforeEach(async () => {
  world.ctx = (await testContext({ withItems: false })).ctx;
});

const idle: IdeaState = { status: null, error: null, undo: null };
const form = (values: Record<string, string>) => {
  const data = new FormData();
  data.set("tripId", TRIP_ID);
  for (const [name, value] of Object.entries(values)) data.set(name, value);
  return data;
};
const ctx = () => {
  if (!world.ctx) throw new Error("no test context");
  return world.ctx;
};
const add = async (title: string, where = "Shenzhen") => {
  await ideaAction(idle, form({ intent: "add", title, where }));
  return present((await listIdeas(ctx(), TRIP_ID, kenny)).find((i) => i.title === title));
};
const present = <T>(value: T | undefined): T => {
  if (value === undefined) throw new Error("missing");
  return value;
};

describe("the Ideas page actions", () => {
  it("adds an idea and says where it went", async () => {
    expect(await ideaAction(idle, form({ intent: "add", title: "Buy gold", where: "Shenzhen" }))).toEqual({ status: "Added to ideas for Shenzhen.", error: null, undo: null });
    expect((await ideaAction(idle, form({ intent: "add", title: "Try the beer" }))).status).toBe("Added to ideas.");
  });

  it("says what was wrong instead of failing, when the idea is empty", async () => {
    expect((await ideaAction(idle, form({ intent: "add", title: "" }))).error).toBe("Say what the idea is, in 200 characters or fewer.");
  });

  it("marks done with an Undo that is Not done, and drops with an Undo that brings it back", async () => {
    const idea = await add("Buy gold");
    const done = await ideaAction(idle, form({ intent: "done", ideaId: idea.id }));
    expect(done).toEqual({ status: "Marked Buy gold as done.", error: null, undo: { intent: "notdone", ideaId: idea.id } });
    expect((await ideaAction(idle, form({ intent: "notdone", ideaId: idea.id }))).status).toBe("Buy gold is back on the list.");
    const dropped = await ideaAction(idle, form({ intent: "drop", ideaId: idea.id }));
    expect(dropped).toEqual({ status: "Dropped Buy gold.", error: null, undo: { intent: "restore", ideaId: idea.id } });
    expect(await listIdeas(ctx(), TRIP_ID, kenny)).toEqual([]);
    await ideaAction(idle, form({ intent: "restore", ideaId: idea.id }));
    expect(await listIdeas(ctx(), TRIP_ID, kenny)).toHaveLength(1);
  });

  it("makes an only me idea through the form that nobody else is shown, and a specific one for the people picked", async () => {
    await ideaAction(idle, form({ intent: "add", title: "Ring shopping", where: "Shenzhen", visibility: "only_me" }));
    const picked = new FormData();
    picked.set("tripId", TRIP_ID);
    picked.set("intent", "add");
    picked.set("title", "Dinner for two");
    picked.set("visibility", "specific");
    picked.append("visibleTo", USERS.jacob.id);
    await ideaAction(idle, picked);
    expect((await listIdeas(ctx(), TRIP_ID, kenny)).map((i) => i.title).sort()).toEqual(["Dinner for two", "Ring shopping"]);
    expect((await listIdeas(ctx(), TRIP_ID, jacob)).map((i) => i.title)).toEqual(["Dinner for two"]);
    const rows = await ctx().db.select().from(t.ideas);
    expect(rows.find((r) => r.title === "Ring shopping")).toMatchObject({ visibility: "only_me", visibleToUserIds: [] });
    expect(rows.find((r) => r.title === "Dinner for two")).toMatchObject({ visibility: "specific", visibleToUserIds: [USERS.jacob.id] });
  });

  it("keeps an idea shared with everyone when the form says nothing about who sees it, and refuses a visibility it does not know", async () => {
    await ideaAction(idle, form({ intent: "add", title: "Buy gold" }));
    expect(present((await ctx().db.select().from(t.ideas))[0]).visibility).toBe("everyone");
    await expect(ideaAction(idle, form({ intent: "add", title: "x", visibility: "world" }))).rejects.toThrow();
  });

  it("lets an edit clear the place and the note", async () => {
    await ideaAction(idle, form({ intent: "add", title: "Massage", where: "Tianyuan Foot Spa, Luohu, Shenzhen", note: "Ask for Ms Lin" }));
    const idea = present((await listIdeas(ctx(), TRIP_ID, kenny))[0]);
    await ideaAction(idle, form({ intent: "edit", ideaId: idea.id, title: "Massage", where: "", note: "" }));
    expect(present((await listIdeas(ctx(), TRIP_ID, kenny))[0])).toMatchObject({ title: "Massage", city: null, location: null, note: "" });
  });

  it("saves an edit", async () => {
    const idea = await add("Buy gold");
    expect((await ideaAction(idle, form({ intent: "edit", ideaId: idea.id, title: "Buy gold bars", where: "Shenzhen" }))).status).toBe("Saved.");
    expect(present((await listIdeas(ctx(), TRIP_ID, kenny))[0]).title).toBe("Buy gold bars");
  });

  it("schedules an idea into a plan and says which one", async () => {
    const idea = await add("Buy gold");
    const result = await ideaAction(idle, form({ intent: "schedule", ideaId: idea.id, title: "Buy gold", city: "Shenzhen", start: "2026-12-08T14:00", end: "2026-12-08T15:00" }));
    expect(result).toEqual({ status: "Scheduled Buy gold for Tue Dec 8, 2:00pm.", error: null, undo: null });
    expect(await listIdeas(ctx(), TRIP_ID, kenny)).toEqual([]);
    expect((await getTripView(ctx(), TRIP_ID, kenny)).items.map((i) => i.title)).toEqual(["Buy gold"]);
  });

  it("says what is wrong with a schedule that ends before it starts, and keeps the idea open and unscheduled", async () => {
    const idea = await add("Buy gold");
    const result = await ideaAction(idle, form({ intent: "schedule", ideaId: idea.id, title: "Buy gold", city: "Shenzhen", start: "2026-12-08T15:00", end: "2026-12-08T14:00" }));
    expect(result.status).toBeNull();
    expect(result.error).toBeTruthy();
    expect((await listIdeas(ctx(), TRIP_ID, kenny)).map((i) => i.state)).toEqual(["open"]);
    expect((await getTripView(ctx(), TRIP_ID, kenny)).items).toEqual([]);
  });

  it("says it already changed, not an error page, when the idea was acted on elsewhere", async () => {
    const idea = await add("Buy gold");
    await ideaAction(idle, form({ intent: "done", ideaId: idea.id }));
    expect((await ideaAction(idle, form({ intent: "done", ideaId: idea.id }))).error).toBe("That idea already changed. Reload the page.");
  });

  it("refuses an intent it does not know and a trip id that is not an id", async () => {
    await expect(ideaAction(idle, form({ intent: "explode" }))).rejects.toThrow();
    await expect(ideaAction(idle, form({ intent: "add", title: "x", tripId: "../x" }))).rejects.toThrow();
  });
});
