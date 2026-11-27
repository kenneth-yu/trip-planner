import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { present } from "@/testing/present";
import { fixture, TRAVELERS, TRIP_ID } from "@/fixtures/december-trip";
import type { CalendarEvent } from "@/domain/import/calendar-event";
import type { Requester } from "@/domain/types";
import * as t from "@/server/db/schema";
import { jacob, kenny, testContext } from "@/server/testing";
import type { ServiceContext } from "@/server/services/context";
import { approveAllClean, approveEntry, decidedEntry, discardEntry, importCalendarEvents, listInbox, mergeEntry } from "@/server/services/inbox-service";
import { getTripView } from "@/server/services/trip-service";
import { AccessDenied } from "@/domain/visibility/project";
import { addAllClean, decideEntry } from "../actions";

const page = vi.hoisted(() => {
  const state: { ctx: ServiceContext | null; requester: Requester | null } = { ctx: null, requester: null };
  return state;
});

vi.mock("next/cache", () => ({ revalidatePath: () => undefined }));

vi.mock("@/server/web", () => ({
  loadTripPage: async () => {
    if (!page.ctx || !page.requester) throw new Error("no test context");
    return { ctx: page.ctx, requester: page.requester };
  },
}));

const events: CalendarEvent[] = fixture.calendarEvents;

function form(entryId: string, action: "add" | "merge" | "discard") {
  const f = new FormData();
  f.set("tripId", TRIP_ID);
  f.set("entryId", entryId);
  f.set("action", action);
  return f;
}

async function oneEntry(opts: { travelerIds?: string[] } = {}) {
  const env = await testContext({ withItems: false });
  await importCalendarEvents(env.ctx, TRIP_ID, kenny, [events[2]], { source: "ics", label: "file", travelerIds: opts.travelerIds });
  const [entry] = await listInbox(env.ctx, TRIP_ID, kenny);
  page.ctx = env.ctx;
  page.requester = kenny;
  return { ...env, entry };
}

describe("an entry someone else already decided", () => {
  beforeEach(() => {
    page.ctx = null;
    page.requester = null;
  });

  it("Jacob adds, Kenneth's stale Add says so and writes nothing", async () => {
    const { ctx, entry } = await oneEntry();
    await approveEntry(ctx, TRIP_ID, entry.id, jacob);
    const result = await decideEntry(form(entry.id, "add"));
    expect(result).toEqual({ kind: "done", outcome: { text: `Jacob already added ${entry.proposed.title}.`, role: "status" } });
    expect((await getTripView(ctx, TRIP_ID, kenny)).items).toHaveLength(1);
  });

  it("Jacob discards, Kenneth's stale Add gets the alert", async () => {
    const { ctx, entry } = await oneEntry();
    await discardEntry(ctx, TRIP_ID, entry.id, jacob);
    const result = await decideEntry(form(entry.id, "add"));
    expect(result).toMatchObject({ kind: "done", outcome: { role: "alert" } });
    expect(JSON.stringify(result)).toContain(`Jacob discarded ${entry.proposed.title}, so it was not added.`);
    expect((await getTripView(ctx, TRIP_ID, kenny)).items).toHaveLength(0);
  });

  it("a double tap leaves one item and says You already added it", async () => {
    const { ctx, entry } = await oneEntry();
    const results = await Promise.all([decideEntry(form(entry.id, "add")), decideEntry(form(entry.id, "add"))]);
    expect((await getTripView(ctx, TRIP_ID, kenny)).items).toHaveLength(1);
    const texts = results.map((r) => (r.kind === "done" ? r.outcome?.text : r.message));
    expect(texts).toContain(`You already added ${entry.proposed.title}.`);
  });

  it("covers every row of the table through the real action", async () => {
    const rows: { first: "add" | "discard"; tapped: "add" | "merge" | "discard"; text: RegExp; role: "status" | "alert" }[] = [
      { first: "add", tapped: "discard", text: /^Jacob already added .*To remove it, open it on the trip and delete it\.$/, role: "alert" },
      { first: "discard", tapped: "discard", text: /^Jacob already discarded /, role: "status" },
      { first: "discard", tapped: "merge", text: /^Jacob discarded .*Add it again from its source/, role: "alert" },
      { first: "add", tapped: "merge", text: /^Jacob added .* as its own item, so nothing was merged\./, role: "alert" },
    ];
    for (const row of rows) {
      const { ctx, entry } = await oneEntry();
      await (row.first === "add" ? approveEntry(ctx, TRIP_ID, entry.id, jacob) : discardEntry(ctx, TRIP_ID, entry.id, jacob));
      const result = await decideEntry(form(entry.id, row.tapped));
      expect(result.kind).toBe("done");
      expect(result.kind === "done" ? result.outcome?.role : null).toBe(row.role);
      expect(result.kind === "done" ? result.outcome?.text : "").toMatch(row.text);
    }
  });

  it("names the decider only while they are a member", async () => {
    const { ctx, db, entry } = await oneEntry();
    await approveEntry(ctx, TRIP_ID, entry.id, jacob);
    expect((await decidedEntry(ctx, TRIP_ID, entry.id, kenny))?.by).toBe("Jacob");
    await db.delete(t.memberships).where(eq(t.memberships.userId, jacob.kind === "member" ? jacob.userId : ""));
    const after = await decidedEntry(ctx, TRIP_ID, entry.id, kenny);
    expect(after?.by).toBeNull();
    expect(JSON.stringify(after)).not.toContain("Jacob");
  });

  it("only editors can ask, and a pending entry is not decided", async () => {
    const { ctx, db, entry } = await oneEntry();
    expect(await decidedEntry(ctx, TRIP_ID, entry.id, kenny)).toBeNull();
    await db.update(t.memberships).set({ role: "viewer" }).where(eq(t.memberships.userId, jacob.kind === "member" ? jacob.userId : ""));
    await expect(decidedEntry(ctx, TRIP_ID, entry.id, jacob)).rejects.toThrow(AccessDenied);
  });
});

describe("Add all without conflicts", () => {
  it("reports what it added and skips an entry another person decided meanwhile", async () => {
    const env = await testContext({ withItems: false });
    page.ctx = env.ctx;
    page.requester = kenny;
    await importCalendarEvents(env.ctx, TRIP_ID, kenny, [events[2], events[6], events[8]], { source: "ics", label: "file" });
    const clean = (await listInbox(env.ctx, TRIP_ID, kenny)).filter((e) => e.clean);
    let raced = false;
    page.ctx = {
      ...env.ctx,
      onTripChanged: async () => {
        if (raced) return;
        raced = true;
        await discardEntry(env.ctx, TRIP_ID, clean[1].id, jacob);
      },
    };
    const f = new FormData();
    f.set("tripId", TRIP_ID);
    expect(await addAllClean(f)).toEqual({ text: "Added 2. 1 was already decided by someone else." });
  });
});

describe("an entry that names a removed traveler", () => {
  async function withRemovedTraveler(travelerIds: string[], removed: string[]) {
    const env = await oneEntry({ travelerIds });
    for (const id of removed) await env.db.delete(t.travelers).where(eq(t.travelers.id, id));
    return env;
  }

  it("is not clean, so Add all leaves it alone", async () => {
    const { ctx } = await withRemovedTraveler([TRAVELERS.kenny, TRAVELERS.jacob], [TRAVELERS.jacob]);
    const [entry] = await listInbox(ctx, TRIP_ID, kenny);
    expect(entry.namesRemovedTraveler).toBe(true);
    expect(entry.clean).toBe(false);
    expect(await approveAllClean(ctx, TRIP_ID, kenny)).toEqual({ added: 0, alreadyDecided: 0, needYou: 0 });
  });

  it("Add saves it without the removed traveler and says so", async () => {
    const { ctx, entry } = await withRemovedTraveler([TRAVELERS.kenny, TRAVELERS.jacob], [TRAVELERS.jacob]);
    const result = await decideEntry(form(entry.id, "add"));
    expect(result).toEqual({ kind: "done", outcome: { text: `Added ${entry.proposed.title} without the removed traveler.`, role: "status" } });
    const [item] = (await getTripView(ctx, TRIP_ID, kenny)).items;
    expect(item.travelerIds).toEqual([TRAVELERS.kenny]);
  });

  it("with every traveler removed the item is saved with none", async () => {
    const { ctx, entry } = await withRemovedTraveler([TRAVELERS.jacob], [TRAVELERS.jacob]);
    await approveEntry(ctx, TRIP_ID, entry.id, kenny);
    expect(present((await getTripView(ctx, TRIP_ID, kenny)).items[0]).travelerIds).toEqual([]);
  });

  it("an entry whose travelers all remain is unchanged and says nothing extra", async () => {
    const { entry } = await oneEntry({ travelerIds: [TRAVELERS.kenny] });
    expect(entry.namesRemovedTraveler).toBe(false);
    expect(await decideEntry(form(entry.id, "add"))).toEqual({ kind: "done", outcome: null });
  });

  it("Merge also leaves the removed traveler off", async () => {
    const env = await testContext({ withItems: false });
    await importCalendarEvents(env.ctx, TRIP_ID, kenny, [events[2]], { source: "ics", label: "file", travelerIds: [TRAVELERS.kenny] });
    const [first] = await listInbox(env.ctx, TRIP_ID, kenny);
    await approveEntry(env.ctx, TRIP_ID, first.id, kenny);
    await importCalendarEvents(env.ctx, TRIP_ID, kenny, [events[2]], { source: "ics", label: "again", travelerIds: [TRAVELERS.jacob] });
    await env.db.delete(t.travelers).where(eq(t.travelers.id, TRAVELERS.jacob));
    const [again] = await listInbox(env.ctx, TRIP_ID, kenny);
    const saved = await mergeEntry(env.ctx, TRIP_ID, again.id, kenny);
    expect(saved.withoutRemovedTraveler).toBe(true);
    expect(present((await getTripView(env.ctx, TRIP_ID, kenny)).items[0]).travelerIds).toEqual([TRAVELERS.kenny]);
  });
});
