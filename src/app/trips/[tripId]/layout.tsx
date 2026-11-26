import styles from "../../ui/page.module.css";
import { loadTripPage } from "@/server/web";
import { TripNav } from "./nav";

export default async function TripLayout({ children, params }: LayoutProps<"/trips/[tripId]">) {
  const { tripId } = await params;
  const { view } = await loadTripPage(tripId);
  return (
    <main className={styles.page}>
      <h1 className={styles.title}>{view.trip.name}</h1>
      <TripNav tripId={tripId} canEdit={view.permissions.canEdit} />
      {children}
    </main>
  );
}
