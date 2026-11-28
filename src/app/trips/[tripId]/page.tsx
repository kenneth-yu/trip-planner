import Link from "next/link";
import { DateTime } from "@/domain/time/luxon";
import styles from "../../ui/page.module.css";
import { loadTripPage } from "@/server/web";
import { checksForTripPage, gridChecks, loadAttention, withoutHiddenBubbles } from "@/server/attention";
import { buildDays } from "@/domain/time/days";
import { buildTripGrid, dayStrip, pickDay, upNext } from "@/domain/timeline/trip-grid";
import { DayView } from "./day-view";
import { AttentionPanel } from "./attention";
import { TripGridView } from "./trip-grid";
import { DayStrip } from "./day-strip";
import { DAY_PANEL_ID } from "./day-panel";
import { UpNext } from "./up-next";
import { WhereSleep } from "./where-sleep";
import { sleepPlan } from "@/domain/timeline/sleep-plan";

export default async function TripPage({ params, searchParams }: PageProps<"/trips/[tripId]">) {
  const { tripId } = await params;
  const { day } = await searchParams;
  const requested = typeof day === "string" ? day : null;
  const { view, ctx, requester } = await loadTripPage(tripId);
  const nowMs = ctx.now().getTime();
  const todayKey = DateTime.fromMillis(nowMs, { zone: view.homeZone }).toISODate();
  const fullGrid = buildTripGrid(view, nowMs);
  const days = buildDays(view);
  const everyDay = requested === "all";
  const attention = await loadAttention(ctx, view, requester);
  const onGrid = gridChecks(view, fullGrid, attention.everyFinding, attention.findings);
  const grid = fullGrid && withoutHiddenBubbles(fullGrid, onGrid.hidden);
  const selected = grid ? pickDay(grid.days, requested) : null;
  const tripChecks = checksForTripPage(attention.findings, view, attention.tripStartMs, nowMs);
  const panelChecks = tripChecks.filter((f) => !onGrid.drawn.has(f.anchor));
  const plan = sleepPlan(view, attention.beforeTrip ? {} : { from: todayKey });
  const canEdit = view.permissions.canEdit;
  const hasAttention = plan.summary !== null || attention.pending > 0 || attention.deadlines.some((d) => !d.passed && d.warning) || panelChecks.length > 0;
  return (
    <>
      {grid && (
        <section className={`${styles.wideOnly} ${styles.gridWrap}`}>
          <TripGridView grid={grid} selectedKey={everyDay ? null : selected} dayHref={(key) => `?day=${key}`} checkHref={(key) => (onGrid.links[key] ? `/trips/${tripId}/deadlines#check-${onGrid.links[key]}` : null)} />
        </section>
      )}
      <div className={styles.wideOnly}>
        <div className={hasAttention ? styles.columns : undefined}>
        {hasAttention && (
          <aside>
            <WhereSleep plan={plan} tripId={tripId} canEdit={canEdit} folded={false} />
            <AttentionPanel data={attention} tripId={tripId} checks={panelChecks} />
          </aside>
        )}
        <div>
          <DayView view={view} days={days} todayKey={todayKey} only={everyDay || !selected ? undefined : selected} anchors={false} />
          {days.length > 1 && (
            <p className={styles.muted}>
              <Link href={everyDay ? "?" : "?day=all"}>{everyDay ? "Show one day at a time" : "Show every day"}</Link>
            </p>
          )}
        </div>
        </div>
      </div>
      <div className={styles.phoneOnly}>
        <WhereSleep plan={plan} tripId={tripId} canEdit={canEdit} folded />
        <UpNext entries={upNext(view, nowMs)} attention={attention} checks={tripChecks} tripId={tripId} />
        {grid && <DayStrip days={dayStrip(grid)} selectedKey={everyDay ? null : selected} />}
        <div id={DAY_PANEL_ID}>
          <DayView view={view} days={days} todayKey={todayKey} only={everyDay || !selected ? undefined : selected} anchors={false} />
        </div>
        {days.length > 1 && (
          <p className={styles.muted}>
            <Link href={everyDay ? "?" : "?day=all"}>{everyDay ? "Show one day at a time" : "Show every day"}</Link>
          </p>
        )}
      </div>
    </>
  );
}
