import { beforeEach, describe, expect, it, vi } from "vitest";
import { count, eq } from "drizzle-orm";
import { TRIP_ID, USERS } from "@/fixtures/december-trip";
import { present } from "@/testing/present";
import * as t from "@/server/db/schema";
import { FakeGoogleCalendar, GoogleApiError } from "@/server/google/calendar-api";
import { enableMirror } from "@/server/services/mirror-service";
import { quickAddItem } from "@/server/services/trip-service";
import { jacob, testContext } from "@/server/testing";
import type { ServiceContext } from "@/server/services/context";
import { deleteAccountAction, type DeleteAccountState } from "./actions";
import { noticeText } from "./notice";

const world = vi.hoisted(() => {
  const state: { ctx: ServiceContext | null; user: { id: string; name: string } | null; jar: Map<string, string>; deleted: string[] } = {
    ctx: null,
    user: null,
    jar: new Map(),
    deleted: [],
  };
  return state;
});

vi.mock("@/server/app-context", () => ({
  requestContext: async () => {
    if (!world.ctx) throw new Error("no test context");
    return world.ctx;
  },
}));

vi.mock("@/server/auth/session", () => ({ currentUser: async () => world.user }));

vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) => {
      const value = world.jar.get(name);
      return value === undefined ? undefined : { name, value };
    },
    set: (name: string, value: string) => {
      world.jar.set(name, value);
    },
    delete: (name: string) => {
      world.deleted.push(name);
      world.jar.delete(name);
    },
  }),
}));

vi.mock("next/navigation", () => ({
  redirect: (path: string) => {
    throw new Error(`redirect:${path}`);
  },
}));

const idle: DeleteAccountState = { status: "idle", blockedBy: [] };

function form(fields: Record<string, string>) {
  const data = new FormData();
  for (const [key, value] of Object.entries(fields)) data.set(key, value);
  return data;
}

async function users(ctx: ServiceContext) {
  const [row] = await ctx.db.select({ n: count() }).from(t.users);
  return present(row).n;
}

describe("deleting your account", () => {
  let google: FakeGoogleCalendar;

  beforeEach(async () => {
    google = new FakeGoogleCalendar();
    world.ctx = (await testContext({ overrides: { googleFor: async () => google } })).ctx;
    world.user = { id: USERS.jacob.id, name: USERS.jacob.name };
    world.jar = new Map();
    world.deleted = [];
  });

  it("deletes only the signed in user, whatever id the form carries", async () => {
    const ctx = present(world.ctx);
    await expect(deleteAccountAction(idle, form({ confirm: "delete", userId: USERS.kenny.id, user: USERS.kenny.id, id: USERS.kenny.id }))).rejects.toThrow("redirect:/");
    const left = await ctx.db.select({ id: t.users.id }).from(t.users);
    expect(left.map((u) => u.id)).toEqual([USERS.kenny.id]);
  });

  it("signs the person out, shows the one time line and leaves the old session useless", async () => {
    const ctx = present(world.ctx);
    await ctx.db.insert(t.authSessions).values({ tokenHash: "s1", userId: USERS.jacob.id, expires: new Date("2027-01-01") });
    await expect(deleteAccountAction(idle, form({ confirm: "  DELETE " }))).rejects.toThrow("redirect:/");
    expect(world.deleted).toEqual(["authjs.session-token"]);
    expect(noticeText(world.jar.get("trip-notice"))).toBe("Your account is deleted.");
    expect(await ctx.db.select().from(t.authSessions).where(eq(t.authSessions.userId, USERS.jacob.id))).toEqual([]);
  });

  it("refuses a wrong confirmation on the server and changes nothing", async () => {
    const ctx = present(world.ctx);
    for (const confirm of ["", "delet", "delete it", "Jacob Feldman"]) {
      expect(await deleteAccountAction(idle, form({ confirm }))).toEqual({ status: "mismatch", blockedBy: [] });
    }
    expect(await users(ctx)).toBe(2);
    expect(world.jar.size).toBe(0);
  });

  it("refuses a bad choice for shared items instead of guessing", async () => {
    expect((await deleteAccountAction(idle, form({ confirm: "delete", shared: "everything" }))).status).toBe("mismatch");
    expect(await users(present(world.ctx))).toBe(2);
  });

  it("sends a signed out caller to sign in and deletes nobody", async () => {
    world.user = null;
    await expect(deleteAccountAction(idle, form({ confirm: "delete" }))).rejects.toThrow("redirect:/sign-in");
    expect(await users(present(world.ctx))).toBe(2);
  });

  it("is blocked while the person owns a trip other people are on, and nothing is deleted", async () => {
    const ctx = present(world.ctx);
    world.user = { id: USERS.kenny.id, name: USERS.kenny.name };
    const state = await deleteAccountAction(idle, form({ confirm: "delete" }));
    expect(state).toEqual({ status: "blocked", blockedBy: [{ tripId: TRIP_ID, name: expect.any(String) }] });
    expect(await users(ctx)).toBe(2);
    expect(world.jar.size).toBe(0);
    expect(world.deleted).toEqual([]);
  });

  it("is blocked when someone joins a solo trip during the deletion, and the account survives", async () => {
    const ctx = present(world.ctx);
    await ctx.db.delete(t.memberships).where(eq(t.memberships.userId, USERS.jacob.id));
    world.user = { id: USERS.kenny.id, name: USERS.kenny.name };
    await enableMirror(ctx, TRIP_ID, USERS.kenny.id);
    const racing = new (class extends FakeGoogleCalendar {
      override async deleteCalendar(calendarId: string) {
        await ctx.db.insert(t.memberships).values({ tripId: TRIP_ID, userId: USERS.jacob.id, role: "viewer" });
        await super.deleteCalendar(calendarId);
      }
    })();
    world.ctx = { ...ctx, googleFor: async () => racing };
    await ctx.db.update(t.calendarMirrors).set({ googleCalendarId: "cal-x" });
    racing.calendars.set("cal-x", { summary: "x", timeZone: "UTC", events: new Map() });
    const state = await deleteAccountAction(idle, form({ confirm: "delete" }));
    expect(state.status).toBe("blocked");
    expect(await users(ctx)).toBe(2);
  });

  it("keeps the account and says so when Google refuses for a transient reason", async () => {
    const ctx = present(world.ctx);
    world.user = { id: USERS.kenny.id, name: USERS.kenny.name };
    await ctx.db.delete(t.memberships).where(eq(t.memberships.userId, USERS.jacob.id));
    await enableMirror(ctx, TRIP_ID, USERS.kenny.id);
    google.failNext = new GoogleApiError(403, "rateLimitExceeded");
    expect(await deleteAccountAction(idle, form({ confirm: "delete" }))).toEqual({ status: "google", blockedBy: [] });
    expect(await users(ctx)).toBe(2);
    expect(world.jar.size).toBe(0);
  });

  it("hands specific items on by default and deletes them when asked", async () => {
    const ctx = present(world.ctx);
    const add = (title: string) =>
      quickAddItem(ctx, TRIP_ID, jacob, { type: "plan", title, city: "Tokyo", startLocal: "2026-12-03T19:00", endLocal: "2026-12-03T21:00" }, { visibility: "specific", visibleToUserIds: [USERS.kenny.id] });
    await add("Birthday dinner");
    await expect(deleteAccountAction(idle, form({ confirm: "delete", shared: "give" }))).rejects.toThrow("redirect:/");
    expect((await ctx.db.select().from(t.items).where(eq(t.items.title, "Birthday dinner"))).length).toBe(1);
  });

  it("deletes specific items when the choice is Delete them", async () => {
    const ctx = present(world.ctx);
    await quickAddItem(
      ctx,
      TRIP_ID,
      jacob,
      { type: "plan", title: "Birthday dinner", city: "Tokyo", startLocal: "2026-12-03T19:00", endLocal: "2026-12-03T21:00" },
      { visibility: "specific", visibleToUserIds: [USERS.kenny.id] },
    );
    await expect(deleteAccountAction(idle, form({ confirm: "delete", shared: "delete" }))).rejects.toThrow("redirect:/");
    expect(await ctx.db.select().from(t.items).where(eq(t.items.title, "Birthday dinner"))).toEqual([]);
  });
});
