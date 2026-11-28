import type { Metadata } from "next";
import { z } from "zod";
import pageStyles from "../../../ui/page.module.css";
import { loadTripPage } from "@/server/web";
import { ACTIVITY_PAGE, listActivityLines } from "@/server/services/activity-service";
import { ActivityList } from "./activity-list";
import { groupLines } from "./describe";

export const metadata: Metadata = { title: "Activity", robots: { index: false, follow: false } };

const Show = z.coerce.number().int().min(ACTIVITY_PAGE).max(1000).catch(ACTIVITY_PAGE);

export default async function ActivityPage({ params, searchParams }: PageProps<"/trips/[tripId]/activity">) {
  const { tripId } = await params;
  const limit = Show.parse((await searchParams).show);
  const { ctx, requester, view } = await loadTripPage(tripId);
  const { lines, more } = await listActivityLines(ctx, tripId, requester, { limit });
  const groups = groupLines(lines, ctx.now().getTime(), view.homeZone);
  return (
    <div className={pageStyles.narrow}>
      <h2 className={pageStyles.sectionTitle}>Activity</h2>
      {groups.length === 0 ? <p>Nothing has changed yet. Changes to this trip will show here.</p> : <ActivityList tripId={tripId} groups={groups} olderHref={more ? `?show=${limit + ACTIVITY_PAGE}` : null} />}
    </div>
  );
}
