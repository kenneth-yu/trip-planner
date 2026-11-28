import { describe, expect, it } from "vitest";
import { TRIP_ID, USERS } from "@/fixtures/december-trip";
import { smartTips } from "@/domain/smarts/tips";
import { fromLocal } from "@/domain/time/format";
import type { Requester } from "@/domain/types";
import { present } from "@/testing/present";
import * as t from "../db/schema";
import { jacob, kenny, testContext } from "../testing";
import { CheckGone, loadChecks } from "./check-service";
import { saveTipPreferences } from "./preference-service";
import { acknowledgeTipsIntro, applySmartFix, loadTipsForPage, tipAnchor } from "./smarts-service";
import { getTripView, updateItem } from "./trip-service";

const VIEWER = { id: "00000000-0000-4000-8100-000000000c01", name: "Mom Feldman" };
const viewer: Requester = { kind: "member", userId: VIEWER.id, homeZone: "America/New_York" };
const linkVisitor: Requester = { kind: "link", homeZone: "UTC" };

async function setup() {
  const world = await testContext();
  await world.db.insert(t.users).values({ id: VIEWER.id, name: VIEWER.name, email: "mom@example.com" });
  await world.db.insert(t.memberships).values({ tripId: TRIP_ID, userId: VIEWER.id, role: "viewer" });
  return world;
}

async function slipDinner(world: Awaited<ReturnType<typeof setup>>) {
  const view = await getTripView(world.ctx, TRIP_ID, kenny);
  const plan = present(view.items.find((i) => i.title === "Jantzen Tailor"));
  const length = Date.parse(plan.end.at) - Date.parse(plan.start.at);
  const start = fromLocal("2026-12-09T06:30", "Asia/Hong_Kong");
  await updateItem(world.ctx, TRIP_ID, plan.id, kenny, {
    title: "Dinner at Jantzen",
    start,
    end: { at: new Date(Date.parse(start.at) + length).toISOString(), zone: "Asia/Hong_Kong" },
  });
  return plan.id;
}

describe("tips on the trip page", () => {
  it("are the domain tips for an editor, each with an anchor", async () => {
    const world = await setup();
    const view = await getTripView(world.ctx, TRIP_ID, kenny);
    const shown = await loadTipsForPage(world.ctx, view, kenny);
    expect(shown.tips.map((x) => x.key)).toEqual(smartTips(view).map((x) => x.key));
    for (const tip of shown.tips) expect(tip.anchor).toBe(tipAnchor(TRIP_ID, tip.key));
  });

  it("never reach viewers or link visitors", async () => {
    const world = await setup();
    const asViewer = await getTripView(world.ctx, TRIP_ID, viewer);
    expect(await loadTipsForPage(world.ctx, asViewer, viewer)).toEqual({ tips: [], showIntro: false });
    const asLink = await getTripView(world.ctx, TRIP_ID, linkVisitor);
    expect(await loadTipsForPage(world.ctx, asLink, linkVisitor)).toEqual({ tips: [], showIntro: false });
  });

  it("go away with the switch and by kind, but stay for the other editor", async () => {
    const world = await setup();
    const view = await getTripView(world.ctx, TRIP_ID, kenny);
    const all = smartTips(view);
    await saveTipPreferences(world.ctx, USERS.kenny.id, { tipsOn: true, kindsOff: ["bags"] });
    expect((await loadTipsForPage(world.ctx, view, kenny)).tips.map((x) => x.kind)).toEqual(all.filter((x) => x.kind !== "bags").map((x) => x.kind));
    await saveTipPreferences(world.ctx, USERS.kenny.id, { tipsOn: false, kindsOff: [] });
    expect((await loadTipsForPage(world.ctx, view, kenny)).tips).toEqual([]);
    const jacobView = await getTripView(world.ctx, TRIP_ID, jacob);
    expect((await loadTipsForPage(world.ctx, jacobView, jacob)).tips).toHaveLength(smartTips(jacobView).length);
  });

  it("show the intro until it is acknowledged", async () => {
    const world = await setup();
    const view = await getTripView(world.ctx, TRIP_ID, kenny);
    const before = await loadTipsForPage(world.ctx, view, kenny);
    expect(before.showIntro).toBe(before.tips.length > 0);
    await acknowledgeTipsIntro(world.ctx, kenny);
    expect((await loadTipsForPage(world.ctx, view, kenny)).showIntro).toBe(false);
  });

  it("turning tips off does not hide checks", async () => {
    const world = await setup();
    await slipDinner(world);
    await saveTipPreferences(world.ctx, USERS.kenny.id, { tipsOn: false, kindsOff: ["airport", "bags", "sleep", "arrival", "border"] });
    const view = await getTripView(world.ctx, TRIP_ID, kenny);
    expect((await loadChecks(world.ctx, view, kenny)).open.some((f) => f.kind === "wrong_time")).toBe(true);
  });
});

describe("applying a suggested fix", () => {
  it("moves the plan to the evening, keeping its length, and the check goes away", async () => {
    const world = await setup();
    const id = await slipDinner(world);
    const view = await getTripView(world.ctx, TRIP_ID, kenny);
    const found = present((await loadChecks(world.ctx, view, kenny)).open.find((f) => f.kind === "wrong_time"));
    await applySmartFix(world.ctx, view, kenny, found.anchor);
    const after = await getTripView(world.ctx, TRIP_ID, kenny);
    expect(present(after.items.find((i) => i.id === id)).start.at).toBe(fromLocal("2026-12-09T18:30", "Asia/Hong_Kong").at);
    expect((await loadChecks(world.ctx, after, kenny)).open.some((f) => f.kind === "wrong_time")).toBe(false);
  });

  it("refuses an anchor that is not showing and a viewer", async () => {
    const world = await setup();
    await slipDinner(world);
    const view = await getTripView(world.ctx, TRIP_ID, kenny);
    await expect(applySmartFix(world.ctx, view, kenny, "0000000000000000")).rejects.toBeInstanceOf(CheckGone);
    const found = present((await loadChecks(world.ctx, view, kenny)).open.find((f) => f.kind === "wrong_time"));
    await expect(applySmartFix(world.ctx, view, viewer, found.anchor)).rejects.toThrow();
    await expect(applySmartFix(world.ctx, view, linkVisitor, found.anchor)).rejects.toThrow();
  });
});
