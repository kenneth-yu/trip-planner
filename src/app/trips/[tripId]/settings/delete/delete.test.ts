import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { count, eq } from "drizzle-orm";
import { TRIP_ID, USERS } from "@/fixtures/december-trip";
import { present } from "@/testing/present";
import type { Requester } from "@/domain/types";
import * as t from "@/server/db/schema";
import { FakeGoogleCalendar, GoogleApiError } from "@/server/google/calendar-api";
import { enableMirror } from "@/server/services/mirror-service";
import { getTripView } from "@/server/services/trip-service";
import { jacob, kenny, testContext } from "@/server/testing";
import type { ServiceContext } from "@/server/services/context";
import { noticeText } from "../../../../account/notice";
import DeleteTripPage from "./page";
import { deleteTripAction, type DeleteTripState } from "./actions";

const world = vi.hoisted(() => {
  const state: { ctx: ServiceContext | null; requester: Requester | null; jar: Map<string, string> } = { ctx: null, requester: null, jar: new Map() };
  return state;
});

vi.mock("@/server/web", () => ({
  loadTripPage: async (tripId: string) => {
    if (!world.ctx || !world.requester) throw new Error("no test context");
    const view = await getTripView(world.ctx, tripId, world.requester);
    return { ctx: world.ctx, requester: world.requester, view };
  },
}));

vi.mock("next/headers", () => ({
  cookies: async () => ({
    set: (name: string, value: string) => {
      world.jar.set(name, value);
    },
  }),
}));

vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new Error("notFound");
  },
  redirect: (path: string) => {
    throw new Error(`redirect:${path}`);
  },
}));

const idle: DeleteTripState = { status: "idle" };
const viewerId = "00000000-0000-4000-8100-000000000a03";
const guestId = "00000000-0000-4000-8100-000000000a04";

function form(fields: Record<string, string>) {
  const data = new FormData();
  for (const [key, value] of Object.entries(fields)) data.set(key, value);
  return data;
}

async function page() {
  return renderToStaticMarkup(await DeleteTripPage({ params: Promise.resolve({ tripId: TRIP_ID }), searchParams: Promise.resolve({}) }));
}

async function tripName(ctx: ServiceContext) {
  const [row] = await ctx.db.select({ name: t.trips.name }).from(t.trips).where(eq(t.trips.id, TRIP_ID));
  return present(row).name;
}

describe("the delete trip page", () => {
  let google: FakeGoogleCalendar;

  beforeEach(async () => {
    google = new FakeGoogleCalendar();
    world.ctx = (await testContext({ overrides: { googleFor: async () => google } })).ctx;
    world.requester = kenny;
    world.jar = new Map();
  });

  it("tells the owner what goes, with the trip name as the hint and the one outlined button", async () => {
    const html = await page();
    expect(html).toContain("Delete ");
    expect(html).toContain("This deletes the trip for everyone on it: every flight, stay and plan, their codes and seats, the deadlines, the inbox, invites and the view link. It cannot be undone.");
    expect(html).toContain("If anyone mirrors this trip to Google Calendar, that calendar is deleted from their Google account too.");
    expect(html).toContain("Type the trip name to confirm");
    expect(html.match(/<button/g)).toHaveLength(1);
    expect(html).toContain("Delete trip");
    expect(html).not.toContain("Cancel");
    expect(html).toContain("Back to the trip");
  });

  it("names one other person with a singular verb, and never an email", async () => {
    const html = await page();
    expect(html).toContain("Jacob Feldman loses access right away.");
    expect(html).not.toContain(USERS.jacob.email);
  });

  it("joins two and three names, and says nothing for a solo trip", async () => {
    const ctx = present(world.ctx);
    await ctx.db.insert(t.users).values([
      { id: viewerId, name: "Maya Chen", email: "maya@example.com" },
      { id: guestId, name: "Sam Lee", email: "sam@example.com" },
    ]);
    await ctx.db.insert(t.memberships).values({ tripId: TRIP_ID, userId: viewerId, role: "viewer" });
    expect(await page()).toContain("Jacob Feldman and Maya Chen lose access right away.");
    await ctx.db.insert(t.memberships).values({ tripId: TRIP_ID, userId: guestId, role: "viewer" });
    expect(await page()).toContain("Jacob Feldman, Maya Chen and Sam Lee lose access right away.");
    await ctx.db.delete(t.memberships).where(eq(t.memberships.role, "viewer"));
    await ctx.db.delete(t.memberships).where(eq(t.memberships.userId, USERS.jacob.id));
    expect(await page()).not.toContain("lose access");
  });

  it("is a 404 for an editor and a viewer, and shows them no trip name hint", async () => {
    const ctx = present(world.ctx);
    world.requester = jacob;
    await expect(page()).rejects.toThrow("notFound");
    await ctx.db.insert(t.users).values({ id: viewerId, name: "Maya Chen", email: "maya@example.com" });
    await ctx.db.insert(t.memberships).values({ tripId: TRIP_ID, userId: viewerId, role: "viewer" });
    world.requester = { kind: "member", userId: viewerId, homeZone: "America/New_York" };
    await expect(page()).rejects.toThrow("notFound");
  });
});

describe("deleting a trip", () => {
  let google: FakeGoogleCalendar;

  beforeEach(async () => {
    google = new FakeGoogleCalendar();
    world.ctx = (await testContext({ overrides: { googleFor: async () => google } })).ctx;
    world.requester = kenny;
    world.jar = new Map();
  });

  async function trips(ctx: ServiceContext) {
    const [row] = await ctx.db.select({ n: count() }).from(t.trips);
    return present(row).n;
  }

  it("deletes the trip when the name is typed in any case with spaces round it, and shows the line once", async () => {
    const ctx = present(world.ctx);
    const name = await tripName(ctx);
    await expect(deleteTripAction(idle, form({ tripId: TRIP_ID, confirm: `  ${name.toUpperCase()} ` }))).rejects.toThrow("redirect:/");
    expect(await trips(ctx)).toBe(0);
    expect(noticeText(world.jar.get("trip-notice"))).toBe("Trip deleted.")
    expect(world.jar.get("trip-notice")).not.toContain(name);
  });

  it("checks the confirmation on the server and keeps everything on a mismatch", async () => {
    const ctx = present(world.ctx);
    for (const confirm of ["", "delete", "Asia", `${await tripName(ctx)} x`]) {
      expect(await deleteTripAction(idle, form({ tripId: TRIP_ID, confirm }))).toEqual({ status: "mismatch" });
    }
    expect(await trips(ctx)).toBe(1);
    expect(world.jar.size).toBe(0);
  });

  it("refuses an editor the way a missing trip is refused, and deletes nothing", async () => {
    const ctx = present(world.ctx);
    world.requester = jacob;
    await expect(deleteTripAction(idle, form({ tripId: TRIP_ID, confirm: await tripName(ctx) }))).rejects.toThrow("notFound");
    expect(await trips(ctx)).toBe(1);
  });

  it("keeps everything and says so when Google refuses for a transient reason", async () => {
    const ctx = present(world.ctx);
    await enableMirror(ctx, TRIP_ID, USERS.kenny.id);
    google.failNext = new GoogleApiError(403, "rateLimitExceeded");
    expect(await deleteTripAction(idle, form({ tripId: TRIP_ID, confirm: await tripName(ctx) }))).toEqual({ status: "google" });
    expect(await trips(ctx)).toBe(1);
    expect(world.jar.size).toBe(0);
    await expect(deleteTripAction(idle, form({ tripId: TRIP_ID, confirm: await tripName(ctx) }))).rejects.toThrow("redirect:/");
    expect(await trips(ctx)).toBe(0);
  });

  it("answers a second submit cleanly once the trip is gone", async () => {
    const ctx = present(world.ctx);
    const name = await tripName(ctx);
    await expect(deleteTripAction(idle, form({ tripId: TRIP_ID, confirm: name }))).rejects.toThrow("redirect:/");
    await expect(deleteTripAction(idle, form({ tripId: TRIP_ID, confirm: name }))).rejects.toThrow();
    expect(await trips(ctx)).toBe(0);
  });

  it("parses its input", async () => {
    await expect(deleteTripAction(idle, form({ tripId: "nope", confirm: "x" }))).rejects.toThrow("notFound");
    await expect(deleteTripAction(idle, form({ tripId: "00000000-0000-4000-8300-0000000000ff", confirm: "x" }))).rejects.toThrow();
  });
});
