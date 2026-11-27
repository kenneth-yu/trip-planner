import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { TRIP_ID, USERS } from "@/fixtures/december-trip";
import { InvalidTransition } from "@/domain/state/machine";
import { AccessDenied } from "@/domain/visibility/project";
import type { Requester } from "@/domain/types";
import * as t from "../db/schema";
import { jacob, kenny, testContext } from "../testing";
import { getTripView } from "./trip-service";
import {
  disableViewLink,
  enableViewLink,
  getViewLinkSettings,
  loadViewLinkTrip,
  resolveViewLink,
  rotateViewLink,
  setLinkShowsDeadlines,
  setViewersSeeDeadlines,
} from "./view-link-service";

const NY = "America/New_York";
const viewer: Requester = { kind: "member", userId: "00000000-0000-4000-8100-0000000000aa", homeZone: NY };
const link: Requester = { kind: "link", homeZone: NY };
const stranger: Requester = { kind: "member", userId: "00000000-0000-4000-8100-0000000000ff", homeZone: NY };

const tokenOf = (url: string) => url.slice(url.lastIndexOf("/") + 1);

async function setup() {
  const env = await testContext();
  await env.db.delete(t.shareLinks).where(eq(t.shareLinks.tripId, TRIP_ID));
  await env.db.insert(t.users).values({ id: viewer.kind === "member" ? viewer.userId : "", name: "Casey Park", email: "casey@example.test" });
  await env.db.insert(t.memberships).values({ tripId: TRIP_ID, userId: viewer.kind === "member" ? viewer.userId : "", role: "viewer" });
  return env;
}

describe("view link lifecycle", () => {
  it("is off until the owner turns it on, then the shown link works and the page data is the trip", async () => {
    const { ctx } = await setup();
    expect((await getViewLinkSettings(ctx, TRIP_ID, kenny)).enabled).toBe(false);
    const { url } = await enableViewLink(ctx, TRIP_ID, kenny);
    expect(url).toMatch(/^https:\/\/trips\.test\/v\/tpv_[A-Za-z0-9_-]{43}$/);
    expect(await resolveViewLink(ctx, tokenOf(url))).toBe(TRIP_ID);
    expect((await loadViewLinkTrip(ctx, tokenOf(url), "UTC"))?.trip.id).toBe(TRIP_ID);
  });

  it("stores only a hash, never the token", async () => {
    const { ctx, db } = await setup();
    const { url } = await enableViewLink(ctx, TRIP_ID, kenny);
    const rows = await db.select().from(t.shareLinks);
    expect(JSON.stringify(rows)).not.toContain(tokenOf(url));
  });

  it("a new link stops the old one at once, and exactly one of two racing rotations survives", async () => {
    const { ctx } = await setup();
    const first = tokenOf((await enableViewLink(ctx, TRIP_ID, kenny)).url);
    const second = tokenOf((await rotateViewLink(ctx, TRIP_ID, kenny)).url);
    expect(await resolveViewLink(ctx, first)).toBeNull();
    expect(await resolveViewLink(ctx, second)).toBe(TRIP_ID);
    const [a, b] = await Promise.all([rotateViewLink(ctx, TRIP_ID, kenny), rotateViewLink(ctx, TRIP_ID, kenny)]);
    const live = await Promise.all([second, tokenOf(a.url), tokenOf(b.url)].map((tok) => resolveViewLink(ctx, tok)));
    expect(live.filter((x) => x !== null)).toHaveLength(1);
  });

  it("a turned off link, an unknown token and a malformed token all give the same answer", async () => {
    const { ctx } = await setup();
    const token = tokenOf((await enableViewLink(ctx, TRIP_ID, kenny)).url);
    await disableViewLink(ctx, TRIP_ID, kenny);
    const answers = await Promise.all([token, `tpv_${"A".repeat(43)}`, "nonsense", "", "tpv_"].map((tok) => loadViewLinkTrip(ctx, tok, "UTC")));
    expect(answers).toEqual([null, null, null, null, null]);
  });

  it("turning it on again makes a new link, and the old one stays dead", async () => {
    const { ctx } = await setup();
    const old = tokenOf((await enableViewLink(ctx, TRIP_ID, kenny)).url);
    await disableViewLink(ctx, TRIP_ID, kenny);
    const fresh = tokenOf((await enableViewLink(ctx, TRIP_ID, kenny)).url);
    expect(fresh).not.toBe(old);
    expect(await resolveViewLink(ctx, old)).toBeNull();
    expect(await resolveViewLink(ctx, fresh)).toBe(TRIP_ID);
  });

  it("refuses the wrong transitions", async () => {
    const { ctx } = await setup();
    await expect(rotateViewLink(ctx, TRIP_ID, kenny)).rejects.toThrow(InvalidTransition);
    await expect(disableViewLink(ctx, TRIP_ID, kenny)).rejects.toThrow(InvalidTransition);
    await enableViewLink(ctx, TRIP_ID, kenny);
    await expect(enableViewLink(ctx, TRIP_ID, kenny)).rejects.toThrow(InvalidTransition);
  });

  it("deleting the trip's link rows stops the link like an unknown token", async () => {
    const { ctx, db } = await setup();
    const token = tokenOf((await enableViewLink(ctx, TRIP_ID, kenny)).url);
    await db.delete(t.trips).where(eq(t.trips.id, TRIP_ID));
    expect(await loadViewLinkTrip(ctx, token, "UTC")).toBeNull();
  });
});

describe("who may change the link", () => {
  it("refuses an editor, a viewer, a view link and a non member with the same text for every action", async () => {
    const { ctx } = await setup();
    await enableViewLink(ctx, TRIP_ID, kenny);
    const texts = new Set<string>();
    const actions = [
      (r: Requester) => enableViewLink(ctx, TRIP_ID, r),
      (r: Requester) => rotateViewLink(ctx, TRIP_ID, r),
      (r: Requester) => disableViewLink(ctx, TRIP_ID, r),
      (r: Requester) => setLinkShowsDeadlines(ctx, TRIP_ID, r, true),
      (r: Requester) => setViewersSeeDeadlines(ctx, TRIP_ID, r, true),
      (r: Requester) => getViewLinkSettings(ctx, TRIP_ID, r),
    ];
    for (const who of [jacob, viewer, link, stranger]) {
      for (const act of actions) {
        try {
          await act(who);
          texts.add("allowed");
        } catch (e) {
          expect(e).toBeInstanceOf(AccessDenied);
          texts.add(e instanceof Error ? e.message : "");
        }
      }
    }
    expect([...texts]).toEqual(["Only the trip owner can do that."]);
  });
});

describe("what a visitor gets", () => {
  it("has no private field, hidden item, busy block, user id or email anywhere in the data", async () => {
    const { ctx } = await setup();
    const token = tokenOf((await enableViewLink(ctx, TRIP_ID, kenny)).url);
    const out = JSON.stringify(await loadViewLinkTrip(ctx, token, "Europe/London"));
    for (const secret of ["PLACEHOLDER_", "30K", "30C", USERS.kenny.id, USERS.jacob.id, USERS.kenny.email, USERS.jacob.email, "tpv_", "createdBy\":\"0", "visibleToUserIds\":[\"0"]) {
      expect(out).not.toContain(secret);
    }
    const view = await loadViewLinkTrip(ctx, token, "Europe/London");
    expect(view?.busy).toEqual([]);
    expect(view?.permissions).toMatchObject({ role: "link", canEdit: false, canSeeSensitive: false, canManageSharing: false });
  });

  it("gives the same item fields as the day view, and none added without a decision", async () => {
    const { ctx } = await setup();
    const token = tokenOf((await enableViewLink(ctx, TRIP_ID, kenny)).url);
    const view = await loadViewLinkTrip(ctx, token, "UTC");
    const first = view?.items[0];
    expect(Object.keys(first ?? {}).sort()).toEqual(
      ["createdAt", "createdBy", "deadlines", "end", "endIsEstimated", "flags", "flight", "id", "location", "notes", "private", "showAsBusy", "start", "startIsEstimated", "status", "stay", "title", "transfer", "travelerIds", "tripId", "type", "updatedAt", "updatedBy", "visibility", "visibleToUserIds"]
        .sort(),
    );
    expect(first?.private).toEqual([]);
    expect(first?.createdBy).toBeNull();
    expect(first?.visibleToUserIds).toEqual([]);
  });

  it("follows each deadline switch for its own audience only", async () => {
    const { ctx } = await setup();
    const token = tokenOf((await enableViewLink(ctx, TRIP_ID, kenny)).url);
    const deadlinesOf = async () => (await loadViewLinkTrip(ctx, token, "UTC"))?.items.flatMap((i) => i.deadlines).length ?? 0;
    const viewerDeadlines = async () => (await getTripView(ctx, TRIP_ID, viewer)).items.flatMap((i) => i.deadlines).length;
    expect([await deadlinesOf(), await viewerDeadlines()]).toEqual([0, 0]);
    await setLinkShowsDeadlines(ctx, TRIP_ID, kenny, true);
    expect(await deadlinesOf()).toBeGreaterThan(0);
    expect(await viewerDeadlines()).toBe(0);
    await setLinkShowsDeadlines(ctx, TRIP_ID, kenny, false);
    await setViewersSeeDeadlines(ctx, TRIP_ID, kenny, true);
    expect(await deadlinesOf()).toBe(0);
    expect(await viewerDeadlines()).toBeGreaterThan(0);
  });

  it("refuses the link deadline switch while the link is off, and junk values", async () => {
    const { ctx } = await setup();
    await expect(setLinkShowsDeadlines(ctx, TRIP_ID, kenny, true)).rejects.toThrow(InvalidTransition);
    await enableViewLink(ctx, TRIP_ID, kenny);
    await expect(setLinkShowsDeadlines(ctx, TRIP_ID, kenny, "yes")).rejects.toThrow();
  });
});
