import type { Metadata } from "next";
import { cookies } from "next/headers";
import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";
import pageStyles from "../../ui/page.module.css";
import { loadLinkPage } from "@/server/web";
import { DateTime } from "@/domain/time/luxon";
import { buildDays } from "@/domain/time/days";
import { parseZoneHint } from "@/domain/time/zone-hint";
import { buildTripGrid, dayStrip, pickDay, tripSpan, upNext } from "@/domain/timeline/trip-grid";
import { visitorStatus } from "@/domain/timeline/visitor-status";
import { buildDeadlineLines } from "@/domain/deadlines/deadlines";
import { DayView } from "../../trips/[tripId]/day-view";
import { DayStrip } from "../../trips/[tripId]/day-strip";
import { TripGridView } from "../../trips/[tripId]/trip-grid";
import { UpNext } from "../../trips/[tripId]/up-next";
import { ZONE_COOKIE, ZoneHint } from "./zone-hint";

export async function generateMetadata({ params }: PageProps<"/v/[token]">): Promise<Metadata> {
  const { token } = await params;
  const loaded = await loadLinkPage(token, null);
  return { title: loaded?.view.trip.name ?? "Link not working", robots: { index: false, follow: false } };
}

const Query = z.object({ view: z.enum(["grid"]).optional().catch(undefined), day: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().catch(undefined) });
const YOUR_TIME = "your time";
const NO_ATTENTION = { deadlines: [], findings: [], pending: 0, pendingFrom: [], beforeTrip: false };

export default async function VisitorPage({ params, searchParams }: PageProps<"/v/[token]">) {
  const { token } = await params;
  const query = Query.parse(await searchParams);
  const hint = parseZoneHint((await cookies()).get(ZONE_COOKIE)?.value);
  const loaded = await loadLinkPage(token, hint);
  if (!loaded) notFound();
  const { ctx, view, zoneKnown } = loaded;
  const nowMs = ctx.now().getTime();
  const days = buildDays(view, { homeLabel: YOUR_TIME, homeReferences: zoneKnown });
  const rawGrid = buildTripGrid(view, nowMs);
  const grid = rawGrid ? { ...rawGrid, travel: rawGrid.travel.map((cell) => cell.filter((e) => e.kind !== "missing")) } : null;
  const selected = grid ? pickDay(grid.days, query.day ?? null) : null;
  const todayKey = DateTime.fromMillis(nowMs, { zone: view.homeZone }).toISODate();
  const status = visitorStatus(view, nowMs, zoneKnown);
  const span = tripSpan(view, nowMs);
  const decisions = buildDeadlineLines(view, nowMs).filter((d) => !d.passed);
  const here = `/v/${token}`;

  return (
    <main className={pageStyles.page}>
      {!hint && <ZoneHint />}
      <h1 className={pageStyles.title}>{view.trip.name}</h1>
      {days.length === 0 || !grid ? (
        <p>Nothing planned yet.</p>
      ) : (
        <>
          {status && <p>{status}</p>}
          {span && <p className={pageStyles.muted}>{span.dates}</p>}
          {query.view === "grid" ? (
            <>
              <section className={pageStyles.gridWrap}>
                <TripGridView grid={grid} selectedKey={selected} dayHref={(key) => `?view=grid&day=${key}`} />
              </section>
              <p>
                <Link href={here}>Back to now</Link>
              </p>
            </>
          ) : (
            <>
              <UpNext entries={upNext(view, nowMs)} attention={NO_ATTENTION} tripId={view.trip.id} linked={false} />
              <DayStrip days={dayStrip(grid).map((d) => ({ ...d, needsAttention: false }))} selectedKey={selected} />
              <DayView view={view} days={days} todayKey={todayKey} only={selected ?? undefined} anchors={false} />
              {decisions.length > 0 && (
                <section className={pageStyles.section}>
                  <h2 className={pageStyles.sectionTitle}>Decisions</h2>
                  <ul className={pageStyles.list}>
                    {decisions.map((d) => (
                      <li key={d.id}>
                        <div>{d.sentence}</div>
                        <div className={pageStyles.muted}>{d.exact}</div>
                      </li>
                    ))}
                  </ul>
                </section>
              )}
              <p className={pageStyles.muted}>
                <Link href="?view=grid">See the whole trip</Link>
              </p>
            </>
          )}
        </>
      )}
    </main>
  );
}
