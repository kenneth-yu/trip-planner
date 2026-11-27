import type { ServiceContext } from "./services/context";
import { disagreementFindings, listInbox } from "./services/inbox-service";
import { buildDeadlineLines, type DeadlineLine } from "@/domain/deadlines/deadlines";
import { runChecks, type Finding } from "@/domain/checks/checks";
import type { TripView } from "@/domain/visibility/project";
import type { Requester } from "@/domain/types";

export interface Attention {
  deadlines: DeadlineLine[];
  findings: Finding[];
  pending: number;
  pendingFrom: string[];
  beforeTrip: boolean;
}

export async function loadAttention(ctx: ServiceContext, view: TripView, requester: Requester): Promise<Attention> {
  const inbox = view.permissions.canEdit ? await listInbox(ctx, view.trip.id, requester) : [];
  const pendingFrom = [...new Set(inbox.map((e) => e.label).filter(Boolean))];
  const firstStart = view.items.map((i) => i.start.at).sort()[0];
  const beforeTrip = !firstStart || ctx.now().toISOString() < firstStart;
  if (!view.permissions.canSeeDeadlines) return { deadlines: [], findings: [], pending: inbox.length, pendingFrom, beforeTrip };
  return {
    deadlines: buildDeadlineLines(view, ctx.now().getTime()),
    findings: runChecks(view, { extra: await disagreementFindings(ctx, view.trip.id, requester) }),
    pending: inbox.length,
    pendingFrom,
    beforeTrip,
  };
}
