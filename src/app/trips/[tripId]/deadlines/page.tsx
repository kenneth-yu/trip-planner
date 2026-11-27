import styles from "../../../ui/page.module.css";
import { loadTripPage } from "@/server/web";
import { loadAttention } from "@/server/attention";
import { AttentionPage } from "../attention";

export default async function DeadlinesPage({ params }: PageProps<"/trips/[tripId]/deadlines">) {
  const { tripId } = await params;
  const { view, ctx, requester } = await loadTripPage(tripId);
  if (!view.permissions.canSeeDeadlines) return <p className={styles.muted}>The trip owner has not shared deadlines.</p>;
  return (
    <div className={styles.narrow}>
      <h1 className={styles.title}>Deadlines and checks</h1>
      <AttentionPage data={await loadAttention(ctx, view, requester)} tripId={tripId} />
    </div>
  );
}
