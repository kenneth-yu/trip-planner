import { and, eq } from "drizzle-orm";
import * as t from "../db/schema";
import { GoogleApiError, type GoogleCalendarApi } from "../google/calendar-api";
import type { ServiceContext } from "./context";
import { requireAggregate } from "./trip-service";
import { buildMirrorEvents, planMirrorSync } from "@/domain/mirror/calendar-mirror";
import { projectTrip } from "@/domain/visibility/project";
import { machine as mirrorMachine, type CalendarMirrorState } from "@/domain/state/calendar-mirror.machine";
import { canTransition, transition } from "@/domain/state/machine";

export function mirrorState(row: { enabled: boolean; lastError: string | null; lastSyncedAt: Date | null }): CalendarMirrorState {
  if (!row.enabled) return "Off";
  if (row.lastError) return "Failed";
  return row.lastSyncedAt ? "InSync" : "Connecting";
}

function isActive(state: CalendarMirrorState): boolean {
  return state !== "Off" && state !== "TornDown";
}

export interface SyncResult {
  created: number;
  updated: number;
  deleted: number;
  calendarId: string;
}

export async function enableMirror(ctx: ServiceContext, tripId: string, userId: string, opts: { includeSensitive?: boolean } = {}) {
  const agg = await requireAggregate(ctx.db, tripId);
  if (!agg.memberships.some((m) => m.userId === userId)) throw new Error("Only trip members can mirror a trip.");
  const [existing] = await ctx.db.select().from(t.calendarMirrors).where(and(eq(t.calendarMirrors.tripId, tripId), eq(t.calendarMirrors.userId, userId)));
  const from = existing ? mirrorState(existing) : "Off";
  const next = from === "Off" ? transition(mirrorMachine, from, "enable") : from;
  const enabled = isActive(next);
  await ctx.db
    .insert(t.calendarMirrors)
    .values({ id: ctx.newId(), tripId, userId, includeSensitive: opts.includeSensitive ?? false, enabled })
    .onConflictDoUpdate({
      target: [t.calendarMirrors.tripId, t.calendarMirrors.userId],
      set: { enabled, includeSensitive: opts.includeSensitive ?? false },
    });
  return syncMirror(ctx, tripId, userId);
}

export async function disableMirror(ctx: ServiceContext, tripId: string, userId: string) {
  const [mirror] = await ctx.db.select().from(t.calendarMirrors).where(and(eq(t.calendarMirrors.tripId, tripId), eq(t.calendarMirrors.userId, userId)));
  if (!mirror) return;
  const from = mirrorState(mirror);
  if (from === "Off") return;
  const next = transition(mirrorMachine, from, "disable");
  await ctx.db.update(t.calendarMirrors).set({ enabled: isActive(next) }).where(eq(t.calendarMirrors.id, mirror.id));
}

export async function teardownMirror(ctx: ServiceContext, tripId: string, userId: string): Promise<void> {
  const [mirror] = await ctx.db.select().from(t.calendarMirrors).where(and(eq(t.calendarMirrors.tripId, tripId), eq(t.calendarMirrors.userId, userId)));
  if (!mirror) return;
  if (mirror.googleCalendarId) {
    const google = await ctx.googleFor?.(userId);
    if (google) await google.deleteCalendar(mirror.googleCalendarId);
  }
  await ctx.db.delete(t.calendarMirrors).where(eq(t.calendarMirrors.id, mirror.id));
}

export type MirrorOutcome =
  | { userId: string; status: "synced"; result: SyncResult }
  | { userId: string; status: "failed"; error: string };

class MirrorUnavailable extends Error {}

function errorText(e: unknown): string {
  return (e instanceof Error ? e.message : String(e)).slice(0, 500);
}

export async function syncMirror(ctx: ServiceContext, tripId: string, userId: string, api?: GoogleCalendarApi): Promise<SyncResult> {
  const [mirror] = await ctx.db.select().from(t.calendarMirrors).where(and(eq(t.calendarMirrors.tripId, tripId), eq(t.calendarMirrors.userId, userId)));
  if (!mirror || !canTransition(mirrorMachine, mirrorState(mirror), "sync")) throw new MirrorUnavailable("Calendar mirroring is off for this trip.");
  const syncing = transition(mirrorMachine, mirrorState(mirror), "sync");
  try {
    const google = api ?? (await ctx.googleFor?.(userId)) ?? null;
    if (!google) throw new MirrorUnavailable("Connect Google Calendar first.");
    const [user] = await ctx.db.select().from(t.users).where(eq(t.users.id, userId));
    const agg = await requireAggregate(ctx.db, tripId);
    const stillMember = agg.memberships.some((m) => m.userId === userId);
    const desired = stillMember
      ? buildMirrorEvents(projectTrip(agg, { kind: "member", userId, homeZone: user?.homeZone ?? "UTC" }), {
          includeSensitive: mirror.includeSensitive,
          appUrl: ctx.appUrl,
        })
      : [];

    let calendarId = mirror.googleCalendarId;
    if (!calendarId) {
      if (!stillMember) throw new MirrorUnavailable("You are no longer on this trip.");
      calendarId = (await google.createCalendar(`${agg.trip.name} (Trip planner)`, user?.homeZone ?? "UTC")).id;
      await ctx.db.update(t.calendarMirrors).set({ googleCalendarId: calendarId }).where(eq(t.calendarMirrors.id, mirror.id));
    }
    const mirrored = await ctx.db.select().from(t.mirrorEvents).where(eq(t.mirrorEvents.mirrorId, mirror.id));
    const result: SyncResult = { created: 0, updated: 0, deleted: 0, calendarId };
    for (const op of planMirrorSync(desired, mirrored)) {
      if (op.op === "create") {
        const { id } = await google.insertEvent(calendarId, op.event);
        await ctx.db.insert(t.mirrorEvents).values({ mirrorId: mirror.id, key: op.key, googleEventId: id, hash: op.hash });
        result.created++;
      } else if (op.op === "update") {
        const googleEventId = await updateOrRecreate(google, calendarId, op.googleEventId, op.event);
        await ctx.db.update(t.mirrorEvents).set({ hash: op.hash, googleEventId }).where(and(eq(t.mirrorEvents.mirrorId, mirror.id), eq(t.mirrorEvents.key, op.key)));
        result.updated++;
      } else {
        await google.deleteEvent(calendarId, op.googleEventId);
        await ctx.db.delete(t.mirrorEvents).where(and(eq(t.mirrorEvents.mirrorId, mirror.id), eq(t.mirrorEvents.key, op.key)));
        result.deleted++;
      }
    }
    const settled = transition(mirrorMachine, syncing, stillMember ? "synced" : "memberLeft");
    await ctx.db
      .update(t.calendarMirrors)
      .set({ lastSyncedAt: ctx.now(), lastError: null, enabled: isActive(settled) })
      .where(eq(t.calendarMirrors.id, mirror.id));
    return result;
  } catch (e) {
    transition(mirrorMachine, syncing, "failed");
    await ctx.db.update(t.calendarMirrors).set({ lastError: errorText(e) }).where(eq(t.calendarMirrors.id, mirror.id));
    throw e;
  }
}

async function updateOrRecreate(google: GoogleCalendarApi, calendarId: string, eventId: string, event: Parameters<GoogleCalendarApi["insertEvent"]>[1]): Promise<string> {
  try {
    await google.updateEvent(calendarId, eventId, event);
    return eventId;
  } catch (e) {
    if (e instanceof GoogleApiError && (e.status === 404 || e.status === 410)) return (await google.insertEvent(calendarId, event)).id;
    throw e;
  }
}

export async function syncTripMirrors(ctx: ServiceContext, tripId: string): Promise<MirrorOutcome[]> {
  const mirrors = await ctx.db.select().from(t.calendarMirrors).where(and(eq(t.calendarMirrors.tripId, tripId), eq(t.calendarMirrors.enabled, true)));
  const settled = await Promise.allSettled(mirrors.map((m) => syncMirror(ctx, tripId, m.userId)));
  return settled.map((s, i): MirrorOutcome =>
    s.status === "fulfilled"
      ? { userId: mirrors[i].userId, status: "synced", result: s.value }
      : { userId: mirrors[i].userId, status: "failed", error: errorText(s.reason) },
  );
}
