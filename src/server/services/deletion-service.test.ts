import { present } from "@/testing/present";
import { describe, expect, it } from "vitest";
import { count, eq, is } from "drizzle-orm";
import type { SQL } from "drizzle-orm";
import { getTableConfig, PgTable } from "drizzle-orm/pg-core";
import { TRIP_ID, USERS } from "@/fixtures/december-trip";
import { AccessDenied } from "@/domain/visibility/project";
import * as schema from "../db/schema";
import * as t from "../db/schema";
import { FakeGoogleCalendar, GoogleApiError, GoogleAuthorizationError } from "../google/calendar-api";
import { jacob, kenny, testContext } from "../testing";
import { enableMirror } from "./mirror-service";
import { getTripView, quickAddItem } from "./trip-service";
import { deleteAccount, deleteTrip, TRIP_DATA_TABLES } from "./deletion-service";
import { NotFound } from "./trip-service";

const strangerId = "00000000-0000-4000-8100-0000000000ff";
const link = { kind: "link" as const, homeZone: "America/New_York" };

async function setup() {
  const google = new FakeGoogleCalendar();
  const env = await testContext({ overrides: { googleFor: async () => google } });
  return { ...env, google };
}

type Env = Awaited<ReturnType<typeof setup>>;

async function populate({ ctx, db }: Env) {
  await enableMirror(ctx, TRIP_ID, USERS.kenny.id);
  await enableMirror(ctx, TRIP_ID, USERS.jacob.id);
  await quickAddItem(ctx, TRIP_ID, jacob, { type: "plan", title: "Ring shopping", city: "Hong Kong", startLocal: "2026-12-05T20:00", endLocal: "2026-12-05T21:00" }, { visibility: "only_me", showAsBusy: true });
  const [batch] = await db.insert(t.importBatches).values({ tripId: TRIP_ID, userId: USERS.jacob.id, source: "manual", label: "x" }).returning();
  await db.insert(t.importedItems).values({ batchId: batch.id, tripId: TRIP_ID, decidedBy: USERS.jacob.id });
  await db.insert(t.checkDismissals).values({ tripId: TRIP_ID, checkKey: "overlap:a:b", dismissedBy: USERS.jacob.id });
  await db.insert(t.activity).values({ tripId: TRIP_ID, actorId: USERS.jacob.id, action: "updated" });
  await db.insert(t.assistantTokens).values({ userId: USERS.jacob.id, tripId: TRIP_ID, label: "trip", tokenHash: "h1" });
  await db.insert(t.assistantTokens).values({ userId: USERS.jacob.id, label: "all", tokenHash: "h2" });
  await db.insert(t.invites).values({ tripId: TRIP_ID, role: "viewer", tokenHash: "i1", createdBy: USERS.jacob.id, expiresAt: new Date("2026-12-31") });
  await db.insert(t.invites).values({ tripId: TRIP_ID, role: "viewer", tokenHash: "i2", createdBy: USERS.kenny.id, expiresAt: new Date("2026-12-31"), acceptedBy: USERS.jacob.id, acceptedAt: new Date("2026-11-20") });
  await db.insert(t.authSessions).values({ tokenHash: "s1", userId: USERS.jacob.id, expires: new Date("2027-01-01") });
  await db.insert(t.authAccounts).values({ userId: USERS.jacob.id, type: "oidc", provider: "google", providerAccountId: "g-1" });
  await db.insert(t.googleConnections).values({ userId: USERS.jacob.id, refreshTokenEnc: "enc", scope: "s" });
  await db.insert(t.authVerificationTokens).values({ identifier: USERS.jacob.email.toUpperCase(), tokenHash: "v1", expires: new Date("2027-01-01") });
  await db.update(t.deadlines).set({ confirmedBy: USERS.jacob.id });
}

async function rows(db: Env["db"], table: PgTable, where?: SQL) {
  const [row] = await db.select({ n: count() }).from(table).where(where);
  return row.n;
}

function schemaTables(): PgTable[] {
  const tables: PgTable[] = [];
  for (const value of Object.values(schema)) if (is(value, PgTable)) tables.push(value);
  return tables;
}

function tripScoped(): PgTable[] {
  return schemaTables().filter((table) => getTableConfig(table).columns.some((c) => c.name === "trip_id"));
}

describe("deleting a trip", () => {
  it("leaves no row for the trip in any table that holds trip data", async () => {
    const env = await setup();
    await populate(env);
    await deleteTrip(env.ctx, TRIP_ID, kenny);
    for (const table of tripScoped()) {
      const column = present(getTableConfig(table).columns.find((c) => c.name === "trip_id"));
      expect(await rows(env.db, table, eq(column, TRIP_ID)), getTableConfig(table).name).toBe(0);
    }
    for (const table of [t.itemPrivate, t.deadlines, t.mirrorEvents, t.trips]) expect(await rows(env.db, table), getTableConfig(table).name).toBe(0);
    expect(await rows(env.db, t.users)).toBe(2);
  });

  it("deletes the Google calendars the app created", async () => {
    const env = await setup();
    await populate(env);
    expect(env.google.calendars.size).toBe(2);
    await deleteTrip(env.ctx, TRIP_ID, kenny);
    expect(env.google.calendars.size).toBe(0);
  });

  it("keeps everything when Google refuses, so it can be retried", async () => {
    const env = await setup();
    await populate(env);
    env.google.failNext = new GoogleApiError(503, "Backend Error");
    await expect(deleteTrip(env.ctx, TRIP_ID, kenny)).rejects.toThrow(GoogleApiError);
    expect(await rows(env.db, t.trips)).toBe(1);
    await deleteTrip(env.ctx, TRIP_ID, kenny);
    expect(await rows(env.db, t.trips)).toBe(0);
    expect(env.google.calendars.size).toBe(0);
  });

  it("only lets the owner delete: editors, viewers, link visitors and strangers are refused", async () => {
    const env = await setup();
    await env.db.insert(t.users).values({ id: strangerId, name: "Sam Rivera", email: "sam@example.com" });
    await env.db.insert(t.memberships).values({ tripId: TRIP_ID, userId: strangerId, role: "viewer" });
    const viewer = { kind: "member" as const, userId: strangerId, homeZone: "America/New_York" };
    for (const who of [jacob, viewer, link]) await expect(deleteTrip(env.ctx, TRIP_ID, who)).rejects.toThrow(AccessDenied);
    await env.db.delete(t.memberships).where(eq(t.memberships.userId, strangerId));
    await expect(deleteTrip(env.ctx, TRIP_ID, viewer)).rejects.toThrow(AccessDenied);
    expect(await rows(env.db, t.trips)).toBe(1);
  });

  it("says a missing trip is not found", async () => {
    const env = await setup();
    await expect(deleteTrip(env.ctx, "00000000-0000-4000-8300-0000000000ff", kenny)).rejects.toThrow(NotFound);
  });
});

describe("trip data table coverage", () => {
  it("lists every table that has a trip_id column", () => {
    const covered = new Set<PgTable>(TRIP_DATA_TABLES);
    const missing = tripScoped().filter((table) => !covered.has(table)).map((table) => getTableConfig(table).name);
    expect(missing).toEqual([]);
  });
});

describe("deleting an account", () => {
  it("is refused while the user owns a trip with other members, and changes nothing", async () => {
    const env = await setup();
    await populate(env);
    const result = await deleteAccount(env.ctx, USERS.kenny.id, { removeHiddenItemsInSharedTrips: true });
    expect(result.blockedBy).toEqual([{ tripId: TRIP_ID, name: "Asia, December 2026" }]);
    expect(await rows(env.db, t.users)).toBe(2);
    expect(await rows(env.db, t.trips)).toBe(1);
    expect(env.google.calendars.size).toBe(2);
  });

  it("deletes an owner's solo trips with the account", async () => {
    const env = await setup();
    await env.db.delete(t.memberships).where(eq(t.memberships.userId, USERS.jacob.id));
    await enableMirror(env.ctx, TRIP_ID, USERS.kenny.id);
    const result = await deleteAccount(env.ctx, USERS.kenny.id, { removeHiddenItemsInSharedTrips: false });
    expect(result.blockedBy).toEqual([]);
    expect(await rows(env.db, t.trips)).toBe(0);
    expect(await rows(env.db, t.items)).toBe(0);
    expect(env.google.calendars.size).toBe(0);
    expect(await rows(env.db, t.users, eq(t.users.id, USERS.kenny.id))).toBe(0);
  });

  it("removes Jacob everywhere and leaves Kenny's trip intact", async () => {
    const env = await setup();
    await populate(env);
    const itemsBefore = await rows(env.db, t.items);
    const result = await deleteAccount(env.ctx, USERS.jacob.id, { removeHiddenItemsInSharedTrips: false });
    expect(result.blockedBy).toEqual([]);
    expect(await rows(env.db, t.trips)).toBe(1);
    expect(await rows(env.db, t.items)).toBe(itemsBefore - 1);
    expect(await rows(env.db, t.memberships)).toBe(1);
    expect(env.google.calendars.size).toBe(1);
    for (const table of [t.authSessions, t.authAccounts, t.googleConnections, t.authVerificationTokens]) expect(await rows(env.db, table), getTableConfig(table).name).toBe(0);
    expect(await rows(env.db, t.assistantTokens)).toBe(0);
    expect(await rows(env.db, t.invites)).toBe(1);
    const [accepted] = await env.db.select().from(t.invites);
    expect(accepted.acceptedBy).toBeNull();
  });

  it("leaves no reference to the user in any table that points at users", async () => {
    const env = await setup();
    await populate(env);
    await deleteAccount(env.ctx, USERS.jacob.id, { removeHiddenItemsInSharedTrips: false });
    const checked: string[] = [];
    for (const table of schemaTables()) {
      for (const fk of getTableConfig(table).foreignKeys) {
        const ref = fk.reference();
        if (ref.foreignTable !== t.users) continue;
        for (const column of ref.columns) {
          const own = present(getTableConfig(table).columns.find((c) => c.name === column.name));
          checked.push(`${getTableConfig(table).name}.${column.name}`);
          expect(await rows(env.db, table, eq(own, USERS.jacob.id)), `${getTableConfig(table).name}.${column.name}`).toBe(0);
        }
      }
    }
    expect(checked.length).toBeGreaterThan(10);
  });

  it.each([true, false])("never shows Jacob's only-me item to Kenny after the account is deleted (flag %s)", async (flag) => {
    const env = await setup();
    await populate(env);
    const before = await getTripView(env.ctx, TRIP_ID, kenny);
    expect(before.items.map((i) => i.title)).not.toContain("Ring shopping");
    await deleteAccount(env.ctx, USERS.jacob.id, { removeHiddenItemsInSharedTrips: flag });
    const after = await getTripView(env.ctx, TRIP_ID, kenny);
    expect(after.items.map((i) => i.title)).not.toContain("Ring shopping");
    expect(await rows(env.db, t.items, eq(t.items.title, "Ring shopping"))).toBe(0);
  });

  it("deletes the activity and approved imports of removed hidden items in the same pass", async () => {
    const env = await setup();
    await populate(env);
    const [ring] = await env.db.select().from(t.items).where(eq(t.items.title, "Ring shopping"));
    await env.db.insert(t.importedItems).values({ batchId: (await env.db.select().from(t.importBatches))[0].id, tripId: TRIP_ID, resultItemId: ring.id, state: "approved" });
    await deleteAccount(env.ctx, USERS.jacob.id, { removeHiddenItemsInSharedTrips: false });
    expect(await rows(env.db, t.activity, eq(t.activity.itemId, ring.id))).toBe(0);
    expect(await rows(env.db, t.importedItems, eq(t.importedItems.resultItemId, ring.id))).toBe(0);
  });

  it("passes a specific item to the first person on its list who stays, or deletes it when nobody does", async () => {
    const env = await setup();
    const sharing = (visibleToUserIds: string[]) => ({ visibility: "specific" as const, visibleToUserIds });
    const plan = (title: string) => ({ type: "plan", title, city: "Tokyo", startLocal: "2026-12-03T19:00", endLocal: "2026-12-03T21:00" });
    await quickAddItem(env.ctx, TRIP_ID, jacob, plan("Birthday dinner"), sharing([strangerId, USERS.kenny.id]));
    await quickAddItem(env.ctx, TRIP_ID, jacob, plan("Gift pickup"), sharing([strangerId]));
    await deleteAccount(env.ctx, USERS.jacob.id, { removeHiddenItemsInSharedTrips: false });
    const titles = (await getTripView(env.ctx, TRIP_ID, kenny)).items.map((i) => i.title);
    expect(titles).toContain("Birthday dinner");
    expect(titles).not.toContain("Gift pickup");
    expect(await rows(env.db, t.items, eq(t.items.title, "Gift pickup"))).toBe(0);
    const [dinner] = await env.db.select().from(t.items).where(eq(t.items.title, "Birthday dinner"));
    expect(dinner.createdBy).toBe(USERS.kenny.id);
    expect(dinner.visibleToUserIds).not.toContain(USERS.jacob.id);
  });

  it("deletes specific items too when the flag is on", async () => {
    const env = await setup();
    await quickAddItem(env.ctx, TRIP_ID, jacob, { type: "plan", title: "Birthday dinner", city: "Tokyo", startLocal: "2026-12-03T19:00", endLocal: "2026-12-03T21:00" }, { visibility: "specific", visibleToUserIds: [USERS.kenny.id] });
    await deleteAccount(env.ctx, USERS.jacob.id, { removeHiddenItemsInSharedTrips: true });
    expect(await rows(env.db, t.items, eq(t.items.title, "Birthday dinner"))).toBe(0);
  });

  it("drops a mirror whose Google access was revoked and carries on", async () => {
    const env = await setup();
    await populate(env);
    env.google.failNext = new GoogleAuthorizationError(401, "invalid_grant");
    await deleteTrip(env.ctx, TRIP_ID, kenny);
    expect(await rows(env.db, t.trips)).toBe(0);
    expect(await rows(env.db, t.calendarMirrors)).toBe(0);
  });

  it("changes nothing when someone joins a trip the user owns while Google is being cleaned up", async () => {
    const google = new class extends FakeGoogleCalendar {
      join: (() => Promise<void>) | null = null;
      override async deleteCalendar(calendarId: string) {
        await this.join?.();
        await super.deleteCalendar(calendarId);
      }
    }();
    const env = await testContext({ overrides: { googleFor: async () => google } });
    await env.db.delete(t.memberships).where(eq(t.memberships.userId, USERS.jacob.id));
    await enableMirror(env.ctx, TRIP_ID, USERS.kenny.id);
    await env.db.insert(t.authSessions).values({ tokenHash: "k1", userId: USERS.kenny.id, expires: new Date("2027-01-01") });
    google.join = () => env.db.insert(t.memberships).values({ tripId: TRIP_ID, userId: USERS.jacob.id, role: "viewer" }).then(() => undefined);
    const itemsBefore = await rows(env.db, t.items);
    const result = await deleteAccount(env.ctx, USERS.kenny.id, { removeHiddenItemsInSharedTrips: true });
    expect(result.blockedBy).toHaveLength(1);
    expect(await rows(env.db, t.users)).toBe(2);
    expect(await rows(env.db, t.trips)).toBe(1);
    expect(await rows(env.db, t.items)).toBe(itemsBefore);
    expect(await rows(env.db, t.authSessions)).toBe(1);
  });

  it("keeps the account when Google fails for a transient reason", async () => {
    const env = await setup();
    await env.db.delete(t.memberships).where(eq(t.memberships.userId, USERS.jacob.id));
    await enableMirror(env.ctx, TRIP_ID, USERS.kenny.id);
    env.google.failNext = new GoogleApiError(503, "Backend Error");
    await expect(deleteAccount(env.ctx, USERS.kenny.id, { removeHiddenItemsInSharedTrips: false })).rejects.toThrow(GoogleApiError);
    expect(await rows(env.db, t.users)).toBe(2);
    expect(await rows(env.db, t.trips)).toBe(1);
  });

  it("removes the user from other people's visible-to lists", async () => {
    const env = await setup();
    await quickAddItem(env.ctx, TRIP_ID, kenny, { type: "plan", title: "Surprise dinner", city: "Tokyo", startLocal: "2026-12-03T19:00", endLocal: "2026-12-03T21:00" }, { visibility: "specific", visibleToUserIds: [USERS.jacob.id] });
    await deleteAccount(env.ctx, USERS.jacob.id, { removeHiddenItemsInSharedTrips: false });
    const [dinner] = await env.db.select().from(t.items).where(eq(t.items.title, "Surprise dinner"));
    expect(dinner.visibleToUserIds).toEqual([]);
  });

  it("says a missing account is not found", async () => {
    const env = await setup();
    await expect(deleteAccount(env.ctx, strangerId, { removeHiddenItemsInSharedTrips: false })).rejects.toThrow(NotFound);
  });
});
