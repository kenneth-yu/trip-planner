import { and, eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { z } from "zod";
import { present } from "@/testing/present";
import { TRIP_ID, USERS } from "@/fixtures/december-trip";
import { AccessDenied } from "@/domain/visibility/project";
import type { Requester } from "@/domain/types";
import * as t from "../db/schema";
import { jacob, kenny, testContext } from "../testing";
import { createAssistantToken, resolveAssistantToken } from "./assistant-service";
import { anchorOf, CheckGone, dismissCheck, loadChecks, restoreCheck, visibleFindings } from "./check-service";
import { getTripView, quickAddItem, updateItem } from "./trip-service";
import { createMcpServer } from "../mcp/server";

type Env = Awaited<ReturnType<typeof testContext>>;

async function stateFor(env: Env, who: Requester) {
  return loadChecks(env.ctx, await getTripView(env.ctx, TRIP_ID, who), who);
}

async function overlapFor(env: Env, who: Requester = kenny) {
  const state = await stateFor(env, who);
  return present(state.open.find((f) => f.kind === "overlapping_stays"));
}

const stranger: Requester = { kind: "member", userId: "00000000-0000-4000-8000-0000000000aa", homeZone: "America/New_York" };
const linkVisitor: Requester = { kind: "link", homeZone: "America/New_York" };

describe("dismissing a check", () => {
  it("hides it for everyone on the trip and lists who marked it", async () => {
    const env = await testContext();
    const overlap = await overlapFor(env);
    await dismissCheck(env.ctx, TRIP_ID, kenny, overlap.anchor);
    const mine = await stateFor(env, kenny);
    expect(mine.open.map((f) => f.anchor)).not.toContain(overlap.anchor);
    expect(mine.dismissed).toEqual([expect.objectContaining({ anchor: overlap.anchor, by: "You", mine: true, on: "Nov 26" })]);
    const theirs = await stateFor(env, jacob);
    expect(theirs.open.map((f) => f.anchor)).not.toContain(overlap.anchor);
    expect(theirs.dismissed).toEqual([expect.objectContaining({ anchor: overlap.anchor, by: "Kenneth", mine: false })]);
  });

  it("restoring brings it back, twice is harmless", async () => {
    const env = await testContext();
    const overlap = await overlapFor(env);
    await dismissCheck(env.ctx, TRIP_ID, kenny, overlap.anchor);
    await restoreCheck(env.ctx, TRIP_ID, jacob, overlap.anchor);
    await restoreCheck(env.ctx, TRIP_ID, jacob, overlap.anchor);
    expect((await stateFor(env, kenny)).open.map((f) => f.anchor)).toContain(overlap.anchor);
    expect((await stateFor(env, kenny)).dismissed).toEqual([]);
  });

  it("two editors dismissing the same check leave one row and no error", async () => {
    const env = await testContext();
    const overlap = await overlapFor(env);
    await Promise.all([dismissCheck(env.ctx, TRIP_ID, kenny, overlap.anchor), dismissCheck(env.ctx, TRIP_ID, jacob, overlap.anchor)]);
    expect(await env.db.select().from(t.checkDismissals).where(eq(t.checkDismissals.tripId, TRIP_ID))).toHaveLength(1);
  });

  it("comes back when an involved item changes, and stays hidden when an unrelated one does", async () => {
    const env = await testContext();
    const overlap = await overlapFor(env);
    await dismissCheck(env.ctx, TRIP_ID, kenny, overlap.anchor);
    const view = await getTripView(env.ctx, TRIP_ID, kenny);
    const unrelated = present(view.items.find((i) => i.type === "plan" && !overlap.itemIds.includes(i.id)));
    await updateItem(env.ctx, TRIP_ID, unrelated.id, kenny, { title: "Renamed plan" });
    expect((await stateFor(env, kenny)).open.map((f) => f.anchor)).not.toContain(overlap.anchor);
    await updateItem(env.ctx, TRIP_ID, present(overlap.itemIds[0]), kenny, { notes: "Changed after dismissal" });
    const after = await stateFor(env, kenny);
    expect(after.open.map((f) => f.sentence)).toContain(overlap.sentence);
    expect(after.dismissed).toEqual([]);
  });

  it("a deleted item leaves no ghost in the list", async () => {
    const env = await testContext();
    const overlap = await overlapFor(env);
    await dismissCheck(env.ctx, TRIP_ID, kenny, overlap.anchor);
    await env.db.delete(t.items).where(eq(t.items.id, present(overlap.itemIds[0])));
    expect((await stateFor(env, kenny)).dismissed).toEqual([]);
  });

  it("a check about nowhere to sleep has no item in its key, so an item edit never brings it back", async () => {
    const env = await testContext();
    await env.db.delete(t.items).where(eq(t.items.type, "stay"));
    const nowhere = present((await stateFor(env, kenny)).open.find((f) => f.kind === "nowhere_to_sleep"));
    expect(nowhere.key).toMatch(/^nowhere_to_sleep\|\d{4}-\d{2}-\d{2}$/);
    await dismissCheck(env.ctx, TRIP_ID, kenny, nowhere.anchor);
    const view = await getTripView(env.ctx, TRIP_ID, kenny);
    await updateItem(env.ctx, TRIP_ID, present(view.items[0]).id, kenny, { notes: "touched" });
    const after = await stateFor(env, kenny);
    expect(after.dismissed.map((d) => d.anchor)).toContain(nowhere.anchor);
    expect(after.open.map((f) => f.anchor)).not.toContain(nowhere.anchor);
  });
});

describe("who may dismiss and restore", () => {
  it("viewers, link visitors and strangers are refused on both actions", async () => {
    const env = await testContext();
    const overlap = await overlapFor(env);
    await dismissCheck(env.ctx, TRIP_ID, kenny, overlap.anchor);
    await env.db.update(t.memberships).set({ role: "viewer" }).where(and(eq(t.memberships.userId, USERS.jacob.id), eq(t.memberships.tripId, TRIP_ID)));
    for (const who of [jacob, linkVisitor, stranger]) {
      await expect(dismissCheck(env.ctx, TRIP_ID, who, overlap.anchor)).rejects.toThrow(AccessDenied);
      await expect(restoreCheck(env.ctx, TRIP_ID, who, overlap.anchor)).rejects.toThrow(AccessDenied);
    }
    expect((await stateFor(env, kenny)).dismissed).toHaveLength(1);
  });

  it("a viewer who may see checks sees dismissed ones vanish and still sees the list", async () => {
    const env = await testContext();
    const overlap = await overlapFor(env);
    await dismissCheck(env.ctx, TRIP_ID, kenny, overlap.anchor);
    await env.db.update(t.memberships).set({ role: "viewer" }).where(and(eq(t.memberships.userId, USERS.jacob.id), eq(t.memberships.tripId, TRIP_ID)));
    await env.db.update(t.trips).set({ viewersSeeDeadlines: true }).where(eq(t.trips.id, TRIP_ID));
    const state = await stateFor(env, jacob);
    expect(state.open.map((f) => f.anchor)).not.toContain(overlap.anchor);
    expect(state.dismissed.map((d) => d.anchor)).toEqual([overlap.anchor]);
  });
});

describe("keys that are not the requester's own findings", () => {
  it("are all refused with the same message and store nothing", async () => {
    const env = await testContext();
    const overlap = await overlapFor(env);
    const forged = [
      "not-an-anchor",
      "",
      "0".repeat(16),
      "g".repeat(16),
      "a".repeat(17),
      anchorOf("00000000-0000-4000-8300-000000000999", overlap.key),
      anchorOf(TRIP_ID, `${overlap.key}x`),
      anchorOf(TRIP_ID, overlap.key.replace(/@[^|]+/, "@2020-01-01T00:00:00.000Z")),
    ];
    const messages = new Set<string>();
    for (const anchor of forged) {
      const failure = await dismissCheck(env.ctx, TRIP_ID, kenny, anchor).then(
        () => null,
        (e: unknown) => e,
      );
      expect(failure).toBeInstanceOf(CheckGone);
      messages.add(failure instanceof Error ? failure.message : "");
      await expect(restoreCheck(env.ctx, TRIP_ID, kenny, anchor)).rejects.toThrow(CheckGone);
    }
    expect(messages.size).toBe(1);
    expect(await env.db.select().from(t.checkDismissals)).toEqual([]);
  });

  it("a stale anchor after the item changed is refused, not stored", async () => {
    const env = await testContext();
    const overlap = await overlapFor(env);
    await updateItem(env.ctx, TRIP_ID, present(overlap.itemIds[0]), kenny, { notes: "Changed first" });
    await expect(dismissCheck(env.ctx, TRIP_ID, kenny, overlap.anchor)).rejects.toThrow(CheckGone);
    await expect(restoreCheck(env.ctx, TRIP_ID, kenny, overlap.anchor)).rejects.toThrow(CheckGone);
    expect(await env.db.select().from(t.checkDismissals)).toEqual([]);
  });

  it("the anchor is a hash that never contains an id or a timestamp from the key", async () => {
    const env = await testContext();
    const overlap = await overlapFor(env);
    expect(overlap.anchor).toMatch(/^[0-9a-f]{16}$/);
    for (const part of overlap.key.split("|").filter(Boolean)) expect(overlap.anchor).not.toContain(part);
  });
});

describe("hidden items", () => {
  const CANARY = "Canary surprise";

  async function withHiddenPlan(env: Env) {
    await quickAddItem(
      env.ctx,
      TRIP_ID,
      jacob,
      { type: "plan", title: CANARY, city: "Kyoto", country: "Japan", startLocal: "2026-12-03T10:00", endLocal: "2026-12-03T11:00" },
      { visibility: "only_me" },
    );
    return present((await stateFor(env, jacob)).open.find((f) => f.sentence.includes(CANARY)));
  }

  it("a dismissal about an item the owner cannot see never reaches the owner", async () => {
    const env = await testContext();
    const hidden = await withHiddenPlan(env);
    const before = await stateFor(env, kenny);
    await dismissCheck(env.ctx, TRIP_ID, jacob, hidden.anchor);
    const after = await stateFor(env, kenny);
    expect(JSON.stringify(after)).not.toContain(CANARY);
    expect(after.dismissed).toEqual(before.dismissed);
    expect(after.open).toEqual(before.open);
    expect((await stateFor(env, jacob)).dismissed.map((d) => d.sentence).join(" ")).toContain(CANARY);
  });

  it("the owner cannot dismiss or restore it by its anchor, and is told nothing about it", async () => {
    const env = await testContext();
    const hidden = await withHiddenPlan(env);
    const refusal = await dismissCheck(env.ctx, TRIP_ID, kenny, hidden.anchor).then(
      () => null,
      (e: unknown) => e,
    );
    expect(refusal).toBeInstanceOf(CheckGone);
    expect(refusal instanceof Error ? refusal.message : "").not.toContain(CANARY);
    await dismissCheck(env.ctx, TRIP_ID, jacob, hidden.anchor);
    await expect(restoreCheck(env.ctx, TRIP_ID, kenny, hidden.anchor)).rejects.toThrow(CheckGone);
    expect((await stateFor(env, jacob)).dismissed).toHaveLength(1);
  });
});

describe("the dismisser", () => {
  it("shows no name once they are no longer on the trip, and no email or id ever", async () => {
    const env = await testContext();
    const overlap = await overlapFor(env);
    await dismissCheck(env.ctx, TRIP_ID, jacob, overlap.anchor);
    await env.db.delete(t.memberships).where(and(eq(t.memberships.userId, USERS.jacob.id), eq(t.memberships.tripId, TRIP_ID)));
    const state = await stateFor(env, kenny);
    expect(state.dismissed).toEqual([expect.objectContaining({ by: null })]);
    const text = JSON.stringify(state.dismissed);
    expect(text).not.toContain(USERS.jacob.id);
    expect(text).not.toContain("@");
  });
});

describe("assistant output", () => {
  const TextContent = z.array(z.object({ type: z.literal("text"), text: z.string() }));

  it("get_trip leaves out a dismissed check and does not list what was dismissed", async () => {
    const env = await testContext();
    const overlap = await overlapFor(env);
    const { token } = await createAssistantToken(env.ctx, USERS.kenny.id, { label: "Kenny's Claude" });
    const who = present(await resolveAssistantToken(env.ctx, token));
    const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
    await createMcpServer(env.ctx, who).connect(serverSide);
    const client = new Client({ name: "test", version: "1.0.0" });
    await client.connect(clientSide);
    const read = async () => TextContent.parse((await client.callTool({ name: "get_trip", arguments: { trip_id: TRIP_ID } })).content)[0].text;
    expect(await read()).toContain(overlap.sentence);
    await dismissCheck(env.ctx, TRIP_ID, kenny, overlap.anchor);
    const after = await read();
    expect(after).not.toContain(overlap.sentence);
    expect(after).not.toMatch(/marked as fine|dismissed/i);
  });

  it("visibleFindings is the same list the pages use", async () => {
    const env = await testContext();
    const overlap = await overlapFor(env);
    await dismissCheck(env.ctx, TRIP_ID, kenny, overlap.anchor);
    const view = await getTripView(env.ctx, TRIP_ID, kenny);
    expect((await visibleFindings(env.ctx, view, kenny)).map((f) => f.key)).toEqual((await stateFor(env, kenny)).open.map((f) => f.key));
  });
});
