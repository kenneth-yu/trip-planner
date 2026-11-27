import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { present } from "@/testing/present";
import { fixture, TRAVELERS, TRIP_ID } from "@/fixtures/december-trip";
import type { CalendarEvent } from "@/domain/import/calendar-event";
import type { Requester } from "@/domain/types";
import * as t from "@/server/db/schema";
import { jacob, kenny, testContext } from "@/server/testing";
import type { ServiceContext } from "@/server/services/context";
import { approveAllClean, approveEntry, decidedEntry, discardEntry, importCalendarEvents, importProposals, listInbox, mergeEntry } from "@/server/services/inbox-service";
import { getTripView, quickAddItem, requireAggregate } from "@/server/services/trip-service";
import { AccessDenied, projectTrip } from "@/domain/visibility/project";
import { inputToProposal } from "@/domain/import/quick-add";
import { addAllClean, decideEntry } from "../actions";
import { entryLabel } from "./messages";

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

function addAllForm(ids: string[]) {
  const f = new FormData();
  f.set("tripId", TRIP_ID);
  for (const id of ids) f.append("entryId", id);
  return f;
}

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

describe("a normal decision", () => {
  it("announces Added, Merged and Discarded", async () => {
    const { ctx, entry } = await oneEntry();
    const title = entry.proposed.title;
    expect(await decideEntry(form(entry.id, "add"))).toEqual({ kind: "done", outcome: { text: `Added ${title}.`, role: "status" } });
    await importCalendarEvents(ctx, TRIP_ID, kenny, [events[2]], { source: "ics", label: "again" });
    const [again] = await listInbox(ctx, TRIP_ID, kenny);
    const into = present(again.match).title;
    expect(await decideEntry(form(again.id, "merge"))).toEqual({ kind: "done", outcome: { text: `Merged ${title} into ${into}.`, role: "status" } });
    await importCalendarEvents(ctx, TRIP_ID, kenny, [events[6]], { source: "ics", label: "third" });
    const [third] = await listInbox(ctx, TRIP_ID, kenny);
    expect(await decideEntry(form(third.id, "discard"))).toEqual({ kind: "done", outcome: { text: `Discarded ${third.proposed.title}.`, role: "status" } });
  });

  it("an entry that no longer exists says so instead of failing", async () => {
    await oneEntry();
    const gone = await decideEntry(form("00000000-0000-4000-8000-000000000000", "add"));
    expect(gone).toEqual({ kind: "done", outcome: { text: "That item is no longer in the inbox.", role: "status" } });
    expect(await decideEntry(form("00000000-0000-4000-8000-000000000000", "discard"))).toEqual(gone);
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
    expect(await addAllClean(addAllForm(clean.map((e) => e.id)))).toEqual({ text: "Added 2. 1 was already decided by someone else." });
  });
});

describe("Add all when the page is stale", () => {
  it("says everything was decided by someone else when nothing was left, and says so differently after your own tap", async () => {
    const env = await testContext({ withItems: false });
    page.ctx = env.ctx;
    page.requester = kenny;
    await importCalendarEvents(env.ctx, TRIP_ID, kenny, [events[2], events[6]], { source: "ics", label: "file" });
    const seen = (await listInbox(env.ctx, TRIP_ID, kenny)).filter((e) => e.clean).map((e) => e.id);
    expect(seen).toHaveLength(2);
    const result = await approveAllClean(env.ctx, TRIP_ID, jacob);
    expect(result.added).toBe(2);
    expect(await addAllClean(addAllForm(seen))).toEqual({ text: "These were already decided by someone else." });
    page.requester = jacob;
    expect(await addAllClean(addAllForm(seen))).toEqual({ text: "These were already decided." });
  });

  it("never adds an entry that arrived after the page was drawn", async () => {
    const env = await testContext({ withItems: false });
    page.ctx = env.ctx;
    page.requester = kenny;
    await importCalendarEvents(env.ctx, TRIP_ID, kenny, [events[2]], { source: "ics", label: "file" });
    const seen = (await listInbox(env.ctx, TRIP_ID, kenny)).map((e) => e.id);
    await importCalendarEvents(env.ctx, TRIP_ID, kenny, [events[6]], { source: "ics", label: "later" });
    expect(await addAllClean(addAllForm(seen))).toEqual({ text: "Added 1." });
    expect(await listInbox(env.ctx, TRIP_ID, kenny)).toHaveLength(1);
  });

  it("entries that name a traveler removed after the page was drawn are left for the person", async () => {
    const env = await testContext({ withItems: false });
    page.ctx = env.ctx;
    page.requester = kenny;
    await importCalendarEvents(env.ctx, TRIP_ID, kenny, [events[2], events[6]], { source: "ics", label: "file", travelerIds: [TRAVELERS.kenny, TRAVELERS.jacob] });
    const seen = (await listInbox(env.ctx, TRIP_ID, kenny)).filter((e) => e.clean).map((e) => e.id);
    await env.db.delete(t.travelers).where(eq(t.travelers.id, TRAVELERS.jacob));
    expect(await addAllClean(addAllForm(seen))).toEqual({ text: "2 still need you: see below." });
  });
});

describe("a traveler removed while Add all runs", () => {
  it("is reported rather than hidden", async () => {
    const env = await testContext({ withItems: false });
    page.requester = kenny;
    await importCalendarEvents(env.ctx, TRIP_ID, kenny, [events[2], events[6]], { source: "ics", label: "file", travelerIds: [TRAVELERS.kenny, TRAVELERS.jacob] });
    const seen = (await listInbox(env.ctx, TRIP_ID, kenny)).filter((e) => e.clean).map((e) => e.id);
    let removed = false;
    page.ctx = {
      ...env.ctx,
      onTripChanged: async () => {
        if (removed) return;
        removed = true;
        await env.db.delete(t.travelers).where(eq(t.travelers.id, TRAVELERS.jacob));
      },
    };
    expect(await addAllClean(addAllForm(seen))).toEqual({ text: "Added 2. 1 was saved without a removed traveler." });
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
    expect(await approveAllClean(ctx, TRIP_ID, kenny)).toEqual({ added: 0, alreadyDecided: 0, alreadyByYou: 0, needYou: 0, withoutRemovedTraveler: 0 });
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

  it("an entry whose travelers all remain gets the plain Added line", async () => {
    const { entry } = await oneEntry({ travelerIds: [TRAVELERS.kenny] });
    expect(entry.namesRemovedTraveler).toBe(false);
    expect(await decideEntry(form(entry.id, "add"))).toEqual({ kind: "done", outcome: { text: `Added ${entry.proposed.title}.`, role: "status" } });
  });

  it("Merge also leaves the removed traveler off", async () => {
    const env = await testContext({ withItems: false });
    await importCalendarEvents(env.ctx, TRIP_ID, kenny, [events[2]], { source: "ics", label: "file", travelerIds: [TRAVELERS.kenny] });
    const [first] = await listInbox(env.ctx, TRIP_ID, kenny);
    await approveEntry(env.ctx, TRIP_ID, first.id, kenny);
    await importCalendarEvents(env.ctx, TRIP_ID, kenny, [events[2]], { source: "ics", label: "again", travelerIds: [TRAVELERS.jacob] });
    await env.db.delete(t.travelers).where(eq(t.travelers.id, TRAVELERS.jacob));
    const [again] = await listInbox(env.ctx, TRIP_ID, kenny);
    page.ctx = env.ctx;
    page.requester = kenny;
    const result = await decideEntry(form(again.id, "merge"));
    expect(result).toEqual({ kind: "done", outcome: { text: `Merged ${entryLabel(again.proposed)} into ${present(again.match).title} without the removed traveler.`, role: "status" } });
    expect(present((await getTripView(env.ctx, TRIP_ID, kenny)).items[0]).travelerIds).toEqual([TRAVELERS.kenny]);
  });
});

describe("private rows that belonged to a removed traveler", () => {
  async function entryWithPrivateRow() {
    const env = await testContext({ withItems: false });
    page.ctx = env.ctx;
    page.requester = kenny;
    const base = inputToProposal({ type: "plan", title: "Dinner at Maisen", city: "Tokyo", startLocal: "2026-12-05T19:00", endLocal: "2026-12-05T21:00" }, [], { homeZone: "America/New_York" });
    const proposal = {
      ...base,
      travelerIds: [TRAVELERS.kenny, TRAVELERS.jacob],
      private: [{ travelerId: TRAVELERS.jacob, seat: "12A", confirmationCode: "ZZ9999", phone: "+1 555 010 0000" }],
    };
    await importProposals(env.ctx, TRIP_ID, kenny, [proposal], { source: "assistant", label: "Claude" });
    await env.db.delete(t.travelers).where(eq(t.travelers.id, TRAVELERS.jacob));
    const [entry] = await listInbox(env.ctx, TRIP_ID, kenny);
    return { ...env, entry };
  }

  it("such an entry is not clean even though only a private row names the removed person", async () => {
    const { entry } = await entryWithPrivateRow();
    expect(entry.namesRemovedTraveler).toBe(true);
    expect(entry.clean).toBe(false);
  });

  it("Add keeps the code and phone, drops the seat and the owner, and says it left someone off", async () => {
    const { ctx, entry } = await entryWithPrivateRow();
    const saved = await approveEntry(ctx, TRIP_ID, entry.id, kenny);
    expect(saved.withoutRemovedTraveler).toBe(true);
    const [item] = (await getTripView(ctx, TRIP_ID, kenny)).items;
    expect(item.travelerIds).toEqual([TRAVELERS.kenny]);
    expect(item.private).toEqual([expect.objectContaining({ travelerId: null, confirmationCode: "ZZ9999", phone: "+1 555 010 0000" })]);
    expect(item.private[0].seat).toBeUndefined();
  });

  it("viewers and view link visitors still see no private rows, and a hidden item stays hidden", async () => {
    const { ctx, db, entry } = await entryWithPrivateRow();
    await approveEntry(ctx, TRIP_ID, entry.id, kenny);
    await quickAddItem(ctx, TRIP_ID, kenny, { type: "plan", title: "Hidden from Jacob", city: "Tokyo", startLocal: "2026-12-06T19:00", endLocal: "2026-12-06T20:00" }, { visibility: "only_me" });
    await db.update(t.memberships).set({ role: "viewer" }).where(eq(t.memberships.userId, jacob.kind === "member" ? jacob.userId : ""));
    const viewer = await getTripView(ctx, TRIP_ID, jacob);
    const agg = await requireAggregate(ctx.db, TRIP_ID);
    const visitor = projectTrip({ ...agg, shareLink: { enabled: true, showsDeadlines: false } }, { kind: "link", homeZone: "America/New_York" });
    for (const view of [viewer, visitor]) {
      const text = JSON.stringify(view);
      expect(view.items.every((i) => i.private.length === 0)).toBe(true);
      for (const secret of ["ZZ9999", "+1 555 010 0000", "12A", "Hidden from Jacob"]) expect(text).not.toContain(secret);
    }
    await db.update(t.memberships).set({ role: "editor" }).where(eq(t.memberships.userId, jacob.kind === "member" ? jacob.userId : ""));
    expect(JSON.stringify(await getTripView(ctx, TRIP_ID, jacob))).not.toContain("Hidden from Jacob");
  });

  it("Merge also drops the seat and keeps the rest", async () => {
    const { ctx, db, entry } = await entryWithPrivateRow();
    await db.update(t.importedItems).set({ state: "discarded" }).where(eq(t.importedItems.id, entry.id));
    await importCalendarEvents(ctx, TRIP_ID, kenny, [{ summary: "Dinner at Maisen", location: "Tokyo, Japan", start: { dateTime: "2026-12-05T19:00:00+09:00" }, end: { dateTime: "2026-12-05T21:00:00+09:00" } }], { source: "ics", label: "x", travelerIds: [TRAVELERS.kenny] });
    const [existing] = await listInbox(ctx, TRIP_ID, kenny);
    await approveEntry(ctx, TRIP_ID, existing.id, kenny);
    const proposal = { ...entry.proposed, travelerIds: [TRAVELERS.kenny, TRAVELERS.jacob] };
    await importProposals(ctx, TRIP_ID, kenny, [proposal], { source: "assistant", label: "Claude again" });
    const [again] = await listInbox(ctx, TRIP_ID, kenny);
    const saved = await mergeEntry(ctx, TRIP_ID, again.id, kenny);
    expect(saved.withoutRemovedTraveler).toBe(true);
    const merged = present((await getTripView(ctx, TRIP_ID, kenny)).items.find((i) => i.id === saved.itemId));
    expect(merged.private.every((p) => p.travelerId === null || p.travelerId === TRAVELERS.kenny)).toBe(true);
    expect(merged.private.some((p) => p.seat === "12A")).toBe(false);
    expect(merged.private.some((p) => p.confirmationCode === "ZZ9999")).toBe(true);
  });
});

describe("a merge target the reader cannot see", () => {
  it("does not hint at an item already on the trip", async () => {
    const env = await testContext({ withItems: false });
    page.ctx = env.ctx;
    page.requester = kenny;
    await quickAddItem(env.ctx, TRIP_ID, jacob, { type: "plan", title: "Surprise dinner", city: "Tokyo", startLocal: "2026-12-05T19:00", endLocal: "2026-12-05T21:00" }, { visibility: "only_me" });
    await importCalendarEvents(env.ctx, TRIP_ID, jacob, [{ summary: "Surprise dinner", location: "Tokyo, Japan", start: { dateTime: "2026-12-05T19:00:00+09:00" }, end: { dateTime: "2026-12-05T21:00:00+09:00" } }], { source: "ics", label: "x", travelerIds: [TRAVELERS.jacob] });
    const [entry] = await listInbox(env.ctx, TRIP_ID, jacob);
    expect(entry.match).not.toBeNull();
    await mergeEntry(env.ctx, TRIP_ID, entry.id, jacob);
    const result = await decideEntry(form(entry.id, "add"));
    const text = result.kind === "done" ? result.outcome.text : "";
    expect(text).toBe("Jacob merged Surprise dinner, so it was not added twice.");
    expect(text).not.toContain("already on the trip");
  });
});
