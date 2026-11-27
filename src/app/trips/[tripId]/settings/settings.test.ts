import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { TRAVELERS, TRIP_ID, USERS } from "@/fixtures/december-trip";
import type { Requester } from "@/domain/types";
import { present } from "@/testing/present";
import { jacob, kenny, testContext } from "@/server/testing";
import * as t from "@/server/db/schema";
import { loadTripAggregate } from "@/server/repo/trip-repo";
import { getTripView } from "@/server/services/trip-service";
import type { ServiceContext } from "@/server/services/context";
import SettingsPage from "./page";
import { addTravelerAction, linkTravelerAction, removeTravelerAction, renameTravelerAction, renameTripAction } from "./actions";
import { TravelerList } from "./forms";

const world = vi.hoisted(() => {
  const state: { ctx: ServiceContext | null; requester: Requester | null } = { ctx: null, requester: null };
  return state;
});

vi.mock("next/cache", () => ({ revalidatePath: () => undefined }));

vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new Error("notFound");
  },
}));

vi.mock("@/server/app-context", () => ({
  requestContext: async () => {
    if (!world.ctx) throw new Error("no test context");
    return world.ctx;
  },
}));

vi.mock("@/server/web", () => ({
  requireUser: async () => {
    if (!world.requester || world.requester.kind !== "member") throw new Error("no test user");
    return { id: world.requester.userId, homeZone: world.requester.homeZone };
  },
  loadTripPage: async (tripId: string) => {
    if (!world.ctx || !world.requester) throw new Error("no test context");
    const view = await getTripView(world.ctx, tripId, world.requester);
    return { ctx: world.ctx, requester: world.requester, view, user: { id: world.requester.kind === "member" ? world.requester.userId : "" } };
  },
}));

const VIEWER_ID = "00000000-0000-4000-8100-000000000c01";

function form(fields: Record<string, string>) {
  const data = new FormData();
  for (const [key, value] of Object.entries(fields)) data.set(key, value);
  return data;
}

async function page() {
  return renderToStaticMarkup(await SettingsPage({ params: Promise.resolve({ tripId: TRIP_ID }), searchParams: Promise.resolve({}) }));
}

describe("the settings page", () => {
  beforeEach(async () => {
    const created = await testContext();
    await created.db.insert(t.users).values({ id: VIEWER_ID, name: "Mom Feldman", email: "mom@example.com" });
    await created.db.insert(t.memberships).values({ tripId: TRIP_ID, userId: VIEWER_ID, role: "viewer" });
    world.ctx = created.ctx;
    world.requester = kenny;
  });

  it("gives the owner a trip name field, the dates, the travelers and a delete link", async () => {
    const html = await page();
    expect(html).toContain("Settings");
    expect(html).toContain('name="name"');
    expect(html).toContain("Save name");
    expect(html).toContain("Set by your bookings.");
    expect(html).toContain("Kenneth Yu");
    expect(html).toContain("Jacob Feldman");
    expect(html).toContain("Add traveler");
    expect(html).toContain(`href="/trips/${TRIP_ID}/settings/delete"`);
  });

  it("shows an editor the name as text with no field, the travelers, and no delete link", async () => {
    world.requester = jacob;
    const html = await page();
    expect(html).not.toContain('name="name"');
    expect(html).not.toContain("Save name");
    expect(html).not.toContain("/settings/delete");
    expect(html).toContain("Asia, December 2026");
    expect(html).toContain("Add traveler");
    expect(html).toContain("You");
  });

  it("is a 404 for a viewer", async () => {
    world.requester = { kind: "member", userId: VIEWER_ID, homeZone: "America/New_York" };
    await expect(page()).rejects.toThrow("notFound");
  });

  it("says there are no dates yet on a trip with no bookings", async () => {
    const empty = await testContext({ withItems: false });
    world.ctx = empty.ctx;
    expect(await page()).toContain("No dates yet. They come from your bookings.");
  });
});

describe("the settings actions", () => {
  beforeEach(async () => {
    vi.stubEnv("SESSION_SECRET", "test-secret-test-secret-test-secret-0123");
    world.ctx = (await testContext()).ctx;
    world.requester = kenny;
  });

  it("lets the owner rename the trip and an editor not", async () => {
    expect(await renameTripAction(form({ tripId: TRIP_ID, name: "Asia, take two" }))).toEqual({ ok: true, id: null, name: "Asia, take two" });
    world.requester = jacob;
    expect(await renameTripAction(form({ tripId: TRIP_ID, name: "Jacob's rename" }))).toEqual({ ok: false, error: "Only the trip owner can do that.", refusal: null });
    expect(present(await loadTripAggregate(present(world.ctx).db, TRIP_ID)).trip.name).toBe("Asia, take two");
  });

  it("returns the page copy for bad names", async () => {
    expect(await renameTripAction(form({ tripId: TRIP_ID, name: " " }))).toMatchObject({ ok: false, error: "Give the trip a name." });
    expect(await addTravelerAction(form({ tripId: TRIP_ID, name: " " }))).toMatchObject({ ok: false, error: "Add a name." });
    expect(await addTravelerAction(form({ tripId: TRIP_ID, name: "jacob feldman" }))).toMatchObject({ ok: false, error: "There is already a traveler called jacob feldman." });
  });

  it("adds a traveler, and the 31st addition in a minute is told to wait", async () => {
    const first = await addTravelerAction(form({ tripId: TRIP_ID, name: "Maya Chen" }));
    expect(first).toMatchObject({ ok: true, name: "Maya Chen" });
    let last = first;
    for (let i = 0; i < 30; i++) last = await addTravelerAction(form({ tripId: TRIP_ID, name: `Guest ${i}` }));
    expect(last).toEqual({ ok: false, error: "Too many changes just now. Wait a minute and try again.", refusal: null });
  });

  it("404s on forged ids and on a traveler id from another trip", async () => {
    await expect(renameTravelerAction(form({ tripId: "not-a-uuid", travelerId: TRAVELERS.jacob, name: "X" }))).rejects.toThrow("notFound");
    await expect(renameTravelerAction(form({ tripId: TRIP_ID, travelerId: "nope", name: "X" }))).rejects.toThrow("notFound");
    const ctx = present(world.ctx);
    const otherTrip = "00000000-0000-4000-8300-0000000000f1";
    const foreign = "00000000-0000-4000-8200-0000000000f1";
    await ctx.db.insert(t.trips).values({ id: otherTrip, name: "Other", ownerId: USERS.kenny.id });
    await ctx.db.insert(t.travelers).values({ id: foreign, tripId: otherTrip, name: "Sam Ortiz", userId: null });
    await expect(renameTravelerAction(form({ tripId: TRIP_ID, travelerId: foreign, name: "Hacked" }))).rejects.toThrow("notFound");
    expect((await ctx.db.select().from(t.travelers).where(eq(t.travelers.id, foreign)))[0]?.name).toBe("Sam Ortiz");
  });

  it("refuses to link a forged user with the same sentence as any other bad pick", async () => {
    const result = await linkTravelerAction(form({ tripId: TRIP_ID, travelerId: TRAVELERS.jacob, userId: "00000000-0000-4000-8100-0000000000ee" }));
    expect(result).toEqual({ ok: false, error: "Pick someone from the list.", refusal: null });
    expect(await linkTravelerAction(form({ tripId: TRIP_ID, travelerId: TRAVELERS.jacob }))).toEqual({ ok: false, error: "Pick someone from the list.", refusal: null });
  });

  it("returns the refusal as plain segments with item links for the page", async () => {
    const result = await removeTravelerAction(form({ tripId: TRIP_ID, travelerId: TRAVELERS.jacob }));
    expect(result).toMatchObject({ ok: false, error: "refused" });
    expect(JSON.stringify(result)).toContain("Take them off");
  });
});

describe("the traveler list", () => {
  const rows = [
    { id: "a", name: "Kenneth Yu", secondary: null, unlinked: false, removable: false },
    { id: "b", name: "Jacob Feldman", secondary: "You", unlinked: false, removable: true },
    { id: "c", name: "Maya Chen", secondary: "No account yet", unlinked: true, removable: true },
  ];

  it("shows each secondary text, a row button with aria-expanded, and Add traveler", () => {
    const html = renderToStaticMarkup(createElement(TravelerList, { tripId: "t", travelers: rows, linkable: [{ userId: "u", name: "Sam" }] }));
    expect(html).toContain("No account yet");
    expect(html).toContain(">You<");
    expect(html.match(/aria-expanded="false"/g)).toHaveLength(3);
    expect(html).toContain("Add traveler");
    expect(html).not.toContain("Rename");
  });
});
