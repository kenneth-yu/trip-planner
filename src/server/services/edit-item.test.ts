import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { present } from "@/testing/present";
import { TRAVELERS, TRIP_ID, USERS } from "@/fixtures/december-trip";
import { editPatch, entriesOfValues, itemToFormValues, parseEditForm, type FormEntries } from "@/domain/import/item-form";
import { inputToProposal, InputProblem } from "@/domain/import/quick-add";
import { AccessDenied } from "@/domain/visibility/project";
import type { VisibleItem } from "@/domain/visibility/project";
import * as t from "../db/schema";
import type { Db } from "../db/client";
import { FakeGoogleCalendar } from "../google/calendar-api";
import { jacob, kenny, testContext } from "../testing";
import { enableMirror, syncTripMirrors } from "./mirror-service";
import { getTripView, NotFound, quickAddItem, removeItem, updateItem } from "./trip-service";
import type { ServiceContext } from "./context";
import type { Requester } from "@/domain/types";

const CODE = "PLACEHOLDER_NH159";
const NOTE = "Gate code 0000";

async function flightOf(ctx: ServiceContext, who: Requester, number: string): Promise<VisibleItem> {
  const view = await getTripView(ctx, TRIP_ID, who);
  return present(view.items.find((i) => i.flight?.flightNumber === number));
}

async function titled(ctx: ServiceContext, who: Requester, title: string): Promise<VisibleItem> {
  const view = await getTripView(ctx, TRIP_ID, who);
  return present(view.items.find((i) => i.title === title));
}

async function submit(ctx: ServiceContext, who: Requester, item: VisibleItem, change: (entries: FormEntries) => FormEntries) {
  const view = await getTripView(ctx, TRIP_ID, who);
  const travelers = view.travelers.filter((x) => item.travelerIds.includes(x.id));
  const entries = change(entriesOfValues(itemToFormValues(item, travelers)));
  const parsed = parseEditForm(entries, { travelerIds: item.travelerIds, previous: item.private });
  if (!parsed.ok) return { ok: false as const, errors: parsed.errors };
  const proposal = inputToProposal({ ...parsed.input, travelers: item.travelerIds }, view.travelers, { homeZone: "America/New_York" });
  const patch = editPatch(item, proposal, parsed.private);
  if (Object.keys(patch).length) await updateItem(ctx, TRIP_ID, item.id, who, patch);
  return { ok: true as const, patch };
}

const set = (entries: FormEntries, key: string, value: string): FormEntries => [...entries.filter(([k]) => k !== key), [key, value]];

async function outcome(work: Promise<unknown>): Promise<unknown> {
  try {
    await work;
    return null;
  } catch (error) {
    return error;
  }
}

async function storedText(db: Db): Promise<string> {
  const [items, privates, activity, events] = await Promise.all([
    db.select().from(t.items),
    db.select().from(t.itemPrivate),
    db.select().from(t.activity),
    db.select().from(t.mirrorEvents),
  ]);
  return JSON.stringify({ items, privates, activity, events }, (key, value) => (key === "sealed" ? "ciphertext" : value));
}

describe("editing codes and seats", () => {
  it("lets an editor set the code and Jacob's seat, and Kenny then sees both seats", async () => {
    const { ctx } = await testContext();
    const nh159 = await flightOf(ctx, jacob, "NH159");
    const result = await submit(ctx, jacob, nh159, (e) => set(set(set(e, `seat:${TRAVELERS.jacob}`, "14B"), `code:${TRAVELERS.kenny}`, CODE), `code:${TRAVELERS.jacob}`, CODE));
    expect(result.ok).toBe(true);
    const seen = await flightOf(ctx, kenny, "NH159");
    const seats = Object.fromEntries(seen.private.flatMap((p) => (p.seat ? [[p.travelerId, p.seat]] : [])));
    expect(seats).toEqual({ [TRAVELERS.kenny]: "30K", [TRAVELERS.jacob]: "14B" });
    expect(seen.private.some((p) => p.confirmationCode === CODE)).toBe(true);
  });

  it("stores one shared code once when every traveler gives the same", async () => {
    const { ctx } = await testContext();
    const nh159 = await flightOf(ctx, kenny, "NH159");
    await submit(ctx, kenny, nh159, (e) => set(set(e, `code:${TRAVELERS.kenny}`, CODE), `code:${TRAVELERS.jacob}`, CODE));
    const seen = await flightOf(ctx, kenny, "NH159");
    expect(seen.private.filter((p) => p.confirmationCode === CODE)).toHaveLength(1);
  });

  it("clears a seat that was emptied instead of storing a blank", async () => {
    const { ctx } = await testContext();
    const nh159 = await flightOf(ctx, kenny, "NH159");
    await submit(ctx, kenny, nh159, (e) => set(e, `seat:${TRAVELERS.jacob}`, ""));
    const seen = await flightOf(ctx, kenny, "NH159");
    expect(seen.private.find((p) => p.travelerId === TRAVELERS.jacob)?.seat).toBeUndefined();
    expect(seen.private.find((p) => p.travelerId === TRAVELERS.kenny)?.seat).toBe("30K");
  });

  it("changes nothing for an untouched save", async () => {
    const { ctx, db } = await testContext();
    const nh159 = await flightOf(ctx, kenny, "NH159");
    const before = (await db.select().from(t.activity)).length;
    const result = await submit(ctx, kenny, nh159, (e) => e);
    expect(result).toEqual({ ok: true, patch: {} });
    expect((await db.select().from(t.activity)).length).toBe(before);
  });

  it("keeps the flags on a save that changes no time or place and clears them when the time changes", async () => {
    const { ctx } = await testContext({ withItems: false });
    const stay = await quickAddItem(ctx, TRIP_ID, kenny, { type: "stay", name: "Hotel Test", city: "Tokyo", checkInDate: "2026-12-02", checkOutDate: "2026-12-04" });
    const flagged = (await getTripView(ctx, TRIP_ID, kenny)).items.find((i) => i.id === stay.id);
    expect(present(flagged).startIsEstimated).toBe(true);
    const view = await getTripView(ctx, TRIP_ID, kenny);
    const item = present(view.items.find((i) => i.id === stay.id));
    await submit(ctx, kenny, item, (e) => set(e, "phone", "+81 0000"));
    const afterPhone = present((await getTripView(ctx, TRIP_ID, kenny)).items.find((i) => i.id === stay.id));
    expect(afterPhone.startIsEstimated).toBe(true);
    expect(afterPhone.private[0].phone).toBe("+81 0000");
    await submit(ctx, kenny, afterPhone, (e) => set(set(e, "checkInTime", "16:30"), "checkInEdited", "1"));
    const afterTime = present((await getTripView(ctx, TRIP_ID, kenny)).items.find((i) => i.id === stay.id));
    expect(afterTime.startIsEstimated).toBe(false);
  });

  it("moves free text notes out of the plaintext column into the sealed row", async () => {
    const { ctx, db } = await testContext({ withItems: false });
    const plan = await quickAddItem(ctx, TRIP_ID, kenny, { type: "plan", title: "Dinner", city: "Tokyo", startLocal: "2026-12-02T19:00", notes: NOTE });
    expect(JSON.stringify(await db.select().from(t.items))).toContain(NOTE);
    const item = await titled(ctx, kenny, "Dinner");
    await submit(ctx, kenny, item, (e) => set(e, "phone", "+81 1111"));
    expect(JSON.stringify(await db.select().from(t.items))).not.toContain(NOTE);
    expect(present((await getTripView(ctx, TRIP_ID, kenny)).items.find((i) => i.id === plan.id)).private[0].notes).toBe(NOTE);
  });

  it("never leaves the code or notes in plaintext in items, activity, private rows or mirror events", async () => {
    const { ctx, db } = await testContext();
    const nh159 = await flightOf(ctx, kenny, "NH159");
    await submit(ctx, kenny, nh159, (e) => set(set(set(e, `code:${TRAVELERS.kenny}`, CODE), `code:${TRAVELERS.jacob}`, CODE), "notes", NOTE));
    const text = await storedText(db);
    expect(text).not.toContain(CODE);
    expect(text).not.toContain(NOTE);
    expect(text).not.toContain("14B");
  });

  it("rejects an edit that names a traveler who is not on the item", async () => {
    const { ctx } = await testContext();
    const nh159 = await flightOf(ctx, kenny, "NH159");
    const foreign = "00000000-0000-4000-8000-00000000dead";
    const result = await submit(ctx, kenny, nh159, (e) => [...e, [`seat:${foreign}`, "1A"]]);
    expect(result.ok).toBe(false);
    await expect(updateItem(ctx, TRIP_ID, nh159.id, kenny, { private: [{ travelerId: foreign, seat: "1A" }] })).rejects.toThrow(InputProblem);
    await expect(updateItem(ctx, TRIP_ID, nh159.id, kenny, { travelerIds: [foreign] })).rejects.toThrow(InputProblem);
  });

  it("drops keys outside the patch and refuses over long or negative values", async () => {
    const { ctx } = await testContext();
    const nh159 = await flightOf(ctx, kenny, "NH159");
    const smuggled = { title: "NH159 renamed", createdBy: USERS.jacob.id, tripId: "x", id: "y", private: [] };
    const updated = await updateItem(ctx, TRIP_ID, nh159.id, kenny, smuggled);
    expect([updated.id, updated.tripId, updated.createdBy]).toEqual([nh159.id, TRIP_ID, (await flightOf(ctx, kenny, "NH159")).createdBy ?? ""]);
    const row = { travelerId: null };
    await expect(updateItem(ctx, TRIP_ID, nh159.id, kenny, { private: [{ ...row, confirmationCode: "x".repeat(61) }] })).rejects.toThrow(InputProblem);
    await expect(updateItem(ctx, TRIP_ID, nh159.id, kenny, { private: [{ ...row, notes: "x".repeat(4001) }] })).rejects.toThrow(InputProblem);
    await expect(updateItem(ctx, TRIP_ID, nh159.id, kenny, { private: [{ ...row, price: { amount: "-5", currency: "USD" } }] })).rejects.toThrow(InputProblem);
  });

  it("refuses a viewer, a link visitor and a stranger", async () => {
    const { ctx, db } = await testContext();
    const nh159 = await flightOf(ctx, kenny, "NH159");
    const viewerId = "00000000-0000-4000-8000-0000000000aa";
    await db.insert(t.users).values({ id: viewerId, name: "Viewer Person", email: "viewer@example.test" });
    await db.insert(t.memberships).values({ tripId: TRIP_ID, userId: viewerId, role: "viewer" });
    const strangerId = "00000000-0000-4000-8000-0000000000bb";
    await db.insert(t.users).values({ id: strangerId, name: "Stranger", email: "stranger@example.test" });
    const patch = { private: [{ travelerId: null, confirmationCode: CODE }] };
    for (const who of [
      { kind: "member" as const, userId: viewerId, homeZone: "America/New_York" },
      { kind: "link" as const, homeZone: "America/New_York" },
      { kind: "member" as const, userId: strangerId, homeZone: "America/New_York" },
    ]) {
      await expect(updateItem(ctx, TRIP_ID, nh159.id, who, patch)).rejects.toThrow(AccessDenied);
      await expect(removeItem(ctx, TRIP_ID, nh159.id, who)).rejects.toThrow(AccessDenied);
    }
  });

  it("answers Kenny on Jacob's only me item exactly as it answers an unknown id", async () => {
    const { ctx } = await testContext({ withItems: false });
    const secret = await quickAddItem(ctx, TRIP_ID, jacob, { type: "plan", title: "Ring shopping", city: "Hong Kong", startLocal: "2026-12-05T20:00", endLocal: "2026-12-05T21:00" }, { visibility: "only_me" });
    const unknown = "00000000-0000-4000-8000-0000000000cc";
    const ofHidden = await outcome(updateItem(ctx, TRIP_ID, secret.id, kenny, { title: "Found" }));
    const ofMissing = await outcome(updateItem(ctx, TRIP_ID, unknown, kenny, { title: "Found" }));
    expect(ofHidden).toBeInstanceOf(NotFound);
    expect(ofHidden).toEqual(ofMissing);
    const removedHidden = await outcome(removeItem(ctx, TRIP_ID, secret.id, kenny));
    const removedMissing = await outcome(removeItem(ctx, TRIP_ID, unknown, kenny));
    expect(removedHidden).toEqual(removedMissing);
  });
});

describe("deleting an item", () => {
  it("removes the item, its private rows and its deadlines and logs one sealed deleted row", async () => {
    const { ctx, db } = await testContext();
    const stay = await titled(ctx, kenny, "Hotel Resol Ueno");
    const flight = await flightOf(ctx, kenny, "NH159");
    await removeItem(ctx, TRIP_ID, stay.id, kenny);
    await removeItem(ctx, TRIP_ID, flight.id, kenny);
    for (const id of [stay.id, flight.id]) {
      expect(await db.select().from(t.items).where(eq(t.items.id, id))).toHaveLength(0);
      expect(await db.select().from(t.itemPrivate).where(eq(t.itemPrivate.itemId, id))).toHaveLength(0);
      expect(await db.select().from(t.deadlines).where(eq(t.deadlines.itemId, id))).toHaveLength(0);
    }
    const deleted = (await db.select().from(t.activity)).filter((a) => a.action === "deleted");
    expect(deleted).toHaveLength(2);
    for (const row of deleted) {
      expect(row.sealed).not.toBeNull();
      expect(row.before).toBeNull();
    }
    const remaining = (await getTripView(ctx, TRIP_ID, kenny)).items.map((i) => i.id);
    expect(remaining).not.toContain(stay.id);
    expect(remaining).not.toContain(flight.id);
  });

  it("leaves no item and no private rows whichever of a delete and an update wins the lock", async () => {
    const { ctx, db } = await testContext();
    const flight = await flightOf(ctx, kenny, "NH159");
    const [removed, updated] = await Promise.allSettled([removeItem(ctx, TRIP_ID, flight.id, kenny), updateItem(ctx, TRIP_ID, flight.id, jacob, { title: "Late edit" })]);
    expect(removed.status).toBe("fulfilled");
    if (updated.status === "rejected") expect(updated.reason).toBeInstanceOf(NotFound);
    expect(await db.select().from(t.items).where(eq(t.items.id, flight.id))).toHaveLength(0);
    expect(await db.select().from(t.itemPrivate).where(eq(t.itemPrivate.itemId, flight.id))).toHaveLength(0);
    expect(await db.select().from(t.deadlines).where(eq(t.deadlines.itemId, flight.id))).toHaveLength(0);
    await expect(removeItem(ctx, TRIP_ID, flight.id, kenny)).rejects.toThrow(NotFound);
  });

  it("answers NotFound to an update that arrives after the delete and never re-creates the item", async () => {
    const { ctx, db } = await testContext();
    const flight = await flightOf(ctx, kenny, "NH159");
    await removeItem(ctx, TRIP_ID, flight.id, kenny);
    await expect(updateItem(ctx, TRIP_ID, flight.id, jacob, { title: "Late edit" })).rejects.toThrow(NotFound);
    expect(await db.select().from(t.items).where(eq(t.items.id, flight.id))).toHaveLength(0);
  });

  it("clears an inbox match instead of failing when the item is deleted", async () => {
    const { ctx, db } = await testContext();
    const flight = await flightOf(ctx, kenny, "NH159");
    await removeItem(ctx, TRIP_ID, flight.id, kenny);
    expect((await db.select().from(t.importedItems)).every((i) => i.matchItemId !== flight.id)).toBe(true);
  });
});

describe("the calendar mirror after edits and deletes", () => {
  it("keeps codes, seats and phone out of Google, and drops the event on delete", async () => {
    const google = new FakeGoogleCalendar();
    const env = await testContext({ overrides: { googleFor: async () => google } });
    env.ctx.onTripChanged = async (tripId) => {
      await syncTripMirrors(env.ctx, tripId);
    };
    await enableMirror(env.ctx, TRIP_ID, USERS.kenny.id);
    const nh159 = await flightOf(env.ctx, kenny, "NH159");
    await submit(env.ctx, kenny, nh159, (e) => set(set(set(e, `code:${TRAVELERS.kenny}`, CODE), `code:${TRAVELERS.jacob}`, CODE), "phone", "+81 5550000"));
    const body = JSON.stringify(google.allEvents());
    for (const secret of [CODE, "+81 5550000", "14B", "30K"]) expect(body).not.toContain(secret);
    expect(google.allEvents().some((e) => e.summary?.includes("NH159"))).toBe(true);
    await removeItem(env.ctx, TRIP_ID, nh159.id, kenny);
    expect(google.allEvents().some((e) => e.summary?.includes("NH159"))).toBe(false);
    expect((await env.db.select().from(t.mirrorEvents)).filter((row) => row.key.includes(nh159.id))).toHaveLength(0);
  });
});

