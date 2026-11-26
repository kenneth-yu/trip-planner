import { DateTime } from "@/domain/time/luxon";
import { loadTripPage } from "@/server/web";
import { buildDays } from "@/domain/time/days";
import { DayView } from "./day-view";

export default async function DayByDayPage({ params }: PageProps<"/trips/[tripId]">) {
  const { tripId } = await params;
  const { view, ctx } = await loadTripPage(tripId);
  const todayKey = DateTime.fromJSDate(ctx.now()).setZone(view.homeZone).toISODate();
  return <DayView view={view} days={buildDays(view)} todayKey={todayKey} />;
}
