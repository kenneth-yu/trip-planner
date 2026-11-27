import Link from "next/link";
import { DateTime } from "@/domain/time/luxon";
import styles from "../../ui/page.module.css";
import { loadTripPage } from "@/server/web";
import { loadAttention } from "@/server/attention";
import { buildDays } from "@/domain/time/days";
import { buildTripGrid, dayStrip, pickDay, upNext } from "@/domain/timeline/trip-grid";
import { DayView } from "./day-view";
import { Attention } from "./attention";
import { TripGridView } from "./trip-grid";
import { DayStrip } from "./day-strip";
import { UpNext } from "./up-next";

export default async function TripPage({ params, searchParams }: PageProps<"/trips/[tripId]">) {
  const { tripId } = await params;
  const { day } = await searchParams;
  const requested = typeof day === "string" ? day : null;
  const { view, ctx, requester } = await loadTripPage(tripId);
  const nowMs = ctx.now().getTime();
  const todayKey = DateTime.fromMillis(nowMs, { zone: view.homeZone }).toISODate();
  const grid = buildTripGrid(view, nowMs);
  const days = buildDays(view);
  const everyDay = requested === "all";
  const selected = grid ? pickDay(grid.days, requested) : null;
  const attention = await loadAttention(ctx, view, requester);
  const hasAttention = attention.pending > 0 || attention.deadlines.some((d) => !d.passed && d.warning) || attention.findings.length > 0;
  return (
    <>
      {grid && (
        <section className={`${styles.wideOnly} ${styles.gridWrap}`}>
          <TripGridView grid={grid} selectedKey={everyDay ? null : selected} dayHref={(key) => `?day=${key}`} />
        </section>
      )}
      <div className={styles.wideOnly}>
        <div className={hasAttention ? styles.columns : undefined}>
        {hasAttention && (
          <aside>
            <Attention data={attention} tripId={tripId} showPassed={false} short />
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
        <UpNext entries={upNext(view, nowMs)} attention={attention} tripId={tripId} />
        {grid && <DayStrip days={dayStrip(grid)} selectedKey={everyDay ? null : selected} />}
        <DayView view={view} days={days} todayKey={todayKey} only={everyDay || !selected ? undefined : selected} anchors={false} />
        {days.length > 1 && (
          <p className={styles.muted}>
            <Link href={everyDay ? "?" : "?day=all"}>{everyDay ? "Show one day at a time" : "Show every day"}</Link>
          </p>
        )}
      </div>
    </>
  );
}
