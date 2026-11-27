import { createHash } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import * as t from "../db/schema";
import type { ServiceContext } from "./context";
import { disagreementFindings } from "./inbox-service";
import { requireAggregate } from "./trip-service";
import { formatShortDate, toLocal } from "@/domain/time/format";
import { runChecks, type Finding } from "@/domain/checks/checks";
import { AccessDenied, assertCanEditTrip, projectTrip, type TripView } from "@/domain/visibility/project";
import type { Requester } from "@/domain/types";

export const CheckAnchor = z.string().regex(/^[0-9a-f]{16}$/);

export class CheckGone extends Error {
  constructor() {
    super("That check is not showing any more. Reload the page.");
    this.name = "CheckGone";
  }
}

export interface OpenCheck extends Finding {
  anchor: string;
}

export interface DismissedCheck {
  anchor: string;
  sentence: string;
  by: string | null;
  mine: boolean;
  on: string;
}

export interface CheckState {
  open: OpenCheck[];
  dismissed: DismissedCheck[];
  everyFinding: OpenCheck[];
}

export function anchorOf(tripId: string, key: string): string {
  return createHash("sha256").update(`check|${tripId}|${key}`).digest("hex").slice(0, 16);
}

function withAnchors(tripId: string, findings: Finding[]): OpenCheck[] {
  return findings.map((f) => ({ ...f, anchor: anchorOf(tripId, f.key) }));
}

async function findingsFor(ctx: ServiceContext, view: TripView, requester: Requester): Promise<OpenCheck[]> {
  return withAnchors(view.trip.id, runChecks(view, { extra: await disagreementFindings(ctx, view.trip.id, requester) }));
}

export async function loadChecks(ctx: ServiceContext, view: TripView, requester: Requester): Promise<CheckState> {
  const everyFinding = await findingsFor(ctx, view, requester);
  if (!everyFinding.length) return { open: [], dismissed: [], everyFinding };
  const rows = await ctx.db
    .select({ key: t.checkDismissals.checkKey, by: t.checkDismissals.dismissedBy, at: t.checkDismissals.dismissedAt })
    .from(t.checkDismissals)
    .where(eq(t.checkDismissals.tripId, view.trip.id));
  const members = await ctx.db
    .select({ userId: t.users.id, name: t.users.name })
    .from(t.memberships)
    .innerJoin(t.users, eq(t.users.id, t.memberships.userId))
    .where(eq(t.memberships.tripId, view.trip.id));
  const rowFor = new Map(rows.map((r) => [r.key, r]));
  const open: OpenCheck[] = [];
  const dismissed: DismissedCheck[] = [];
  for (const f of everyFinding) {
    const row = rowFor.get(f.key);
    if (!row) {
      open.push(f);
      continue;
    }
    const mine = requester.kind === "member" && requester.userId === row.by;
    const member = members.find((m) => m.userId === row.by);
    dismissed.push({
      anchor: f.anchor,
      sentence: f.sentence,
      by: mine ? "You" : (member?.name.split(" ")[0] ?? null),
      mine,
      on: formatShortDate(toLocal({ at: row.at.toISOString(), zone: view.homeZone })),
    });
  }
  return { open, dismissed, everyFinding };
}

export async function visibleFindings(ctx: ServiceContext, view: TripView, requester: Requester): Promise<Finding[]> {
  return (await loadChecks(ctx, view, requester)).open;
}

export async function dismissCheck(ctx: ServiceContext, tripId: string, requester: Requester, anchor: string): Promise<void> {
  if (requester.kind !== "member") throw new AccessDenied();
  const extra = await disagreementFindings(ctx, tripId, requester);
  await ctx.db.transaction(async (tx) => {
    const agg = await requireAggregate(tx, tripId);
    assertCanEditTrip(agg, requester);
    const parsed = CheckAnchor.safeParse(anchor);
    const target = parsed.success ? withAnchors(tripId, runChecks(projectTrip(agg, requester), { extra })).find((f) => f.anchor === parsed.data) : undefined;
    if (!target) throw new CheckGone();
    await tx
      .insert(t.checkDismissals)
      .values({ tripId, checkKey: target.key, dismissedBy: requester.userId, dismissedAt: ctx.now() })
      .onConflictDoNothing();
  });
}

export async function restoreCheck(ctx: ServiceContext, tripId: string, requester: Requester, anchor: string): Promise<void> {
  const parsed = CheckAnchor.safeParse(anchor);
  const agg = await requireAggregate(ctx.db, tripId);
  assertCanEditTrip(agg, requester);
  if (!parsed.success) throw new CheckGone();
  const candidates = await findingsFor(ctx, projectTrip(agg, requester), requester);
  const target = candidates.find((c) => c.anchor === parsed.data);
  if (!target) throw new CheckGone();
  await ctx.db.delete(t.checkDismissals).where(and(eq(t.checkDismissals.tripId, tripId), eq(t.checkDismissals.checkKey, target.key)));
}
