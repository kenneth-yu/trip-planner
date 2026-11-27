import { DateTime } from "@/domain/time/luxon";
import styles from "../../ui/page.module.css";
import { loadTripPage } from "@/server/web";
import { loadAttention } from "@/server/attention";
import { buildDays } from "@/domain/time/days";
import { buildTripGrid } from "@/domain/timeline/trip-grid";
import { DayView } from "./day-view";
import { Attention } from "./attention";
import { TripGridView } from "./trip-grid";

export default async function TripPage({ params }: PageProps<"/trips/[tripId]">) {
  const { tripId } = await params;
  const { view, ctx, requester } = await loadTripPage(tripId);
  const nowMs = ctx.now().getTime();
  const todayKey = DateTime.fromMillis(nowMs, { zone: view.homeZone }).toISODate();
  const grid = buildTripGrid(view, nowMs);
  const attention = await loadAttention(ctx, view, requester);
  const hasAttention = attention.pending > 0 || attention.deadlines.some((d) => !d.passed) || attention.findings.length > 0;
  return (
    <>
      {grid && (
        <section className={`${styles.wideOnly} ${styles.gridWrap}`}>
          <TripGridView grid={grid} dayHref={(key) => `#day-${key}`} />
        </section>
      )}
      <div className={hasAttention ? styles.columns : undefined}>
        {hasAttention && (
          <aside className={styles.wideOnly}>
            <Attention data={attention} tripId={tripId} showPassed={false} />
          </aside>
        )}
        <div>
          <DayView view={view} days={buildDays(view)} todayKey={todayKey} />
        </div>
      </div>
    </>
  );
}
