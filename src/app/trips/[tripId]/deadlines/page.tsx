import styles from "../../../ui/page.module.css";
import { loadTripPage } from "@/server/web";
import { buildDeadlineLines } from "@/domain/deadlines/deadlines";
import { runChecks } from "@/domain/checks/checks";
import { disagreementFindings } from "@/server/services/inbox-service";

export default async function DeadlinesPage({ params }: PageProps<"/trips/[tripId]/deadlines">) {
  const { tripId } = await params;
  const { view, ctx, requester } = await loadTripPage(tripId);
  if (!view.permissions.canSeeDeadlines) return <p className={styles.muted}>The trip owner has not shared deadlines.</p>;
  const lines = buildDeadlineLines(view, ctx.now().getTime());
  const findings = runChecks(view, { extra: await disagreementFindings(ctx, tripId, requester) });
  const upcoming = lines.filter((l) => !l.passed);
  const passed = lines.filter((l) => l.passed);
  return (
    <>
      <ul className={styles.list}>
        {upcoming.map((l) => (
          <li key={l.id}>
            <div className={l.warning ? styles.warning : undefined}>{l.sentence}</div>
            <div className={styles.muted}>
              {l.exact}
              {l.needsConfirming && " · Check the booking terms"}
            </div>
          </li>
        ))}
      </ul>
      {findings.length > 0 && (
        <section className={styles.section}>
          <h2 className={styles.sectionTitle}>Worth a look</h2>
          <ul className={styles.list}>
            {findings.map((f) => (
              <li key={f.key}>{f.sentence}</li>
            ))}
          </ul>
        </section>
      )}
      {passed.length > 0 && (
        <details className={styles.section}>
          <summary className={styles.muted}>Passed</summary>
          <ul className={styles.list}>
            {passed.map((l) => (
              <li key={l.id} className={styles.muted}>
                {l.sentence}
              </li>
            ))}
          </ul>
        </details>
      )}
    </>
  );
}
