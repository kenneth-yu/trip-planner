import { Fragment } from "react";
import styles from "../../ui/page.module.css";
import { loadTripPage } from "@/server/web";
import { buildTripGrid, spanText, tripSpan } from "@/domain/timeline/trip-grid";
import { TripNav } from "./nav";
import { JoinedNotice } from "@/app/invite/joined-notice";

function listOf(names: string[]): string {
  return names.length <= 2 ? names.join(" and ") : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

export default async function TripLayout({ children, params }: LayoutProps<"/trips/[tripId]">) {
  const { tripId } = await params;
  const { view, ctx, user } = await loadTripPage(tripId);
  const nowMs = ctx.now().getTime();
  const span = tripSpan(view, nowMs);
  const route = buildTripGrid(view, nowMs)?.route ?? [];
  const others = view.travelers.filter((t) => t.name !== user.name).map((t) => t.name.split(" ")[0]);
  return (
    <main className={styles.trip}>
      <h1 className={styles.hello}>{view.trip.name}</h1>
      {route.length > 1 && (
        <p className={`${styles.route} ${styles.wideOnly}`}>
          {route.map((city, i) => (
            <Fragment key={`${city}-${i}`}>
              {i > 0 && " "}
              <span className={styles.stop}>
                {i > 0 && <span className={styles.arrow}>→</span>}
                {city}
              </span>
            </Fragment>
          ))}
        </p>
      )}
      {span && (
        <p className={styles.span}>
          {spanText(span)}
          {others.length > 0 && ` · with ${listOf(others)}`}
        </p>
      )}
      <JoinedNotice tripId={tripId} />
      <TripNav tripId={tripId} canEdit={view.permissions.canEdit} canManageSharing={view.permissions.canManageSharing} />
      {children}
    </main>
  );
}
