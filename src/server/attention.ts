import type { ServiceContext } from "./services/context";
import { listInbox } from "./services/inbox-service";
import { loadChecks, type DismissedCheck, type OpenCheck } from "./services/check-service";
import { buildDeadlineLines, type DeadlineLine } from "@/domain/deadlines/deadlines";
import { byImportance } from "@/domain/checks/checks";
import { itemCity } from "@/domain/time/days";
import { instantMs } from "@/domain/time/format";
import type { TravelEntry, TripGrid } from "@/domain/timeline/trip-grid";
import type { TripView } from "@/domain/visibility/project";
import type { Requester } from "@/domain/types";

export interface Attention {
  deadlines: DeadlineLine[];
  findings: OpenCheck[];
  dismissed: DismissedCheck[];
  everyFinding: OpenCheck[];
  canEdit: boolean;
  pending: number;
  pendingFrom: string[];
  beforeTrip: boolean;
  tripStartMs: number | null;
}

export async function loadAttention(ctx: ServiceContext, view: TripView, requester: Requester): Promise<Attention> {
  const inbox = view.permissions.canEdit ? await listInbox(ctx, view.trip.id, requester) : [];
  const pendingFrom = [...new Set(inbox.map((e) => e.label).filter(Boolean))];
  const firstStart = view.items.map((i) => i.start.at).sort()[0];
  const beforeTrip = !firstStart || ctx.now().toISOString() < firstStart;
  const base = {
    canEdit: view.permissions.canEdit,
    pending: inbox.length,
    pendingFrom,
    beforeTrip,
    tripStartMs: firstStart ? instantMs(firstStart) : null,
  };
  if (!view.permissions.canSeeDeadlines) return { ...base, deadlines: [], findings: [], dismissed: [], everyFinding: [] };
  const checks = await loadChecks(ctx, view, requester);
  return {
    ...base,
    deadlines: buildDeadlineLines(view, ctx.now().getTime()),
    findings: byImportance(checks.open),
    dismissed: checks.dismissed,
    everyFinding: checks.everyFinding,
  };
}

export const TRIP_PAGE_WINDOW_MS = 14 * 86400_000;
export const TRIP_PAGE_LIMIT = 5;

export function checksForTripPage(findings: OpenCheck[], view: Pick<TripView, "items">, tripStartMs: number | null, nowMs: number): OpenCheck[] {
  const horizon = nowMs + TRIP_PAGE_WINDOW_MS;
  if (tripStartMs !== null && tripStartMs <= horizon) return findings;
  const startOf = new Map(view.items.map((i) => [i.id, instantMs(i.start)]));
  return findings.filter((f) => {
    const starts = f.itemIds.map((id) => startOf.get(id)).filter((ms): ms is number => ms !== undefined);
    return starts.length > 0 && Math.min(...starts) <= horizon;
  });
}

export interface GridChecks {
  links: Record<string, string>;
  hidden: Set<string>;
  drawn: Set<string>;
}

export function gridChecks(view: Pick<TripView, "items">, grid: TripGrid | null, everyFinding: OpenCheck[], open: OpenCheck[]): GridChecks {
  const links: Record<string, string> = {};
  const hidden = new Set<string>();
  const drawn = new Set<string>();
  if (!grid) return { links, hidden, drawn };
  const openAnchors = new Set(open.map((f) => f.anchor));
  const cityOf = (id: string) => {
    const item = view.items.find((i) => i.id === id);
    return item ? itemCity(item) : null;
  };
  const missing: TravelEntry[] = grid.travel.flat().filter((t) => t.kind === "missing");
  for (const entry of missing) {
    const to = entry.title.replace(/^No way to /, "").replace(/ booked$/, "");
    const finding = everyFinding.find((f) => f.kind === "city_change_no_transport" && f.itemIds[1] !== undefined && cityOf(f.itemIds[1]) === to);
    if (!finding) continue;
    if (openAnchors.has(finding.anchor)) {
      links[entry.key] = finding.anchor;
      drawn.add(finding.anchor);
    } else {
      hidden.add(entry.key);
    }
  }
  for (const span of grid.unsure) {
    const finding = everyFinding.find((f) => f.kind === "overlapping_stays" && f.itemIds.includes(span.itemId));
    if (!finding || !openAnchors.has(finding.anchor)) continue;
    links[span.key] = finding.anchor;
    drawn.add(finding.anchor);
  }
  return { links, hidden, drawn };
}

export function withoutHiddenBubbles(grid: TripGrid, hidden: Set<string>): TripGrid {
  if (!hidden.size) return grid;
  return { ...grid, travel: grid.travel.map((cell) => cell.filter((t) => !hidden.has(t.key))) };
}

export interface PhoneAlert {
  kind: "deadline" | "inbox" | "check";
  sentence: string;
  more: number;
  moreIsInboxOnly: boolean;
}

export function phoneAlert(a: Pick<Attention, "deadlines" | "pending">, checks: OpenCheck[]): PhoneAlert | null {
  const soon = a.deadlines.filter((d) => !d.passed && d.warning);
  const inbox = a.pending > 0 ? 1 : 0;
  if (soon.length) {
    const others = soon.length - 1 + checks.length;
    return { kind: "deadline", sentence: soon[0].sentence, more: others + inbox, moreIsInboxOnly: others === 0 && inbox === 1 };
  }
  if (inbox) return { kind: "inbox", sentence: "", more: checks.length, moreIsInboxOnly: false };
  if (checks.length) return { kind: "check", sentence: checks[0].sentence, more: checks.length - 1, moreIsInboxOnly: false };
  return null;
}
