import styles from "../../../ui/page.module.css";
import { loadTripPage } from "@/server/web";
import { buildTripGrid } from "@/domain/timeline/trip-grid";
import { TripGridView } from "../trip-grid";

export default async function TimelinePage({ params }: PageProps<"/trips/[tripId]/timeline">) {
  const { tripId } = await params;
  const { view, ctx } = await loadTripPage(tripId);
  const grid = buildTripGrid(view, ctx.now().getTime());
  if (!grid) return <p className={styles.muted}>Add your first flight or stay.</p>;
  return <TripGridView grid={grid} dayHref={(key) => `/trips/${tripId}#day-${key}`} />;
}
