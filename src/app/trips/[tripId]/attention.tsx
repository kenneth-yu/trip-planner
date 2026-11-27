import Link from "next/link";
import styles from "../../ui/page.module.css";
import type { Attention as AttentionData } from "@/server/attention";
import type { DeadlineLine } from "@/domain/deadlines/deadlines";

function Deadlines({ title, lines }: { title: string; lines: DeadlineLine[] }) {
  if (!lines.length) return null;
  return (
    <section className={styles.section}>
      <h2 className={styles.sectionTitle}>{title}</h2>
      <ul className={styles.list}>
        {lines.map((l) => (
          <li key={l.id}>
            <div className={l.warning ? styles.warning : undefined}>{l.sentence}</div>
            <div className={styles.muted}>
              {l.exact}
              {l.needsConfirming && " · Check the booking terms"}
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}

function sentFrom(names: string[]): string {
  if (!names.length) return "Imported";
  return names.length === 1 ? `From ${names[0]}` : `From ${names.slice(0, -1).join(", ")} and ${names.at(-1)}`;
}

export function Attention({ data, tripId, showPassed }: { data: AttentionData; tripId: string; showPassed: boolean }) {
  const upcoming = data.deadlines.filter((l) => !l.passed);
  const soon = upcoming.filter((l) => l.warning);
  const later = upcoming.filter((l) => !l.warning);
  const passed = data.deadlines.filter((l) => l.passed);
  return (
    <>
      {data.pending > 0 && (
        <Link className={styles.callout} href={`/trips/${tripId}/inbox`}>
          {data.pending === 1 ? "1 new item to look over" : `${data.pending} new items to look over`}
          <small>{sentFrom(data.pendingFrom)}. Nothing is added until you say so.</small>
        </Link>
      )}
      <Deadlines title={data.beforeTrip ? "Decide in the next few days" : "Coming up"} lines={soon} />
      <Deadlines title={soon.length ? "Later" : "Decisions ahead"} lines={later} />
      {data.findings.length > 0 && (
        <section className={styles.section}>
          <h2 className={styles.sectionTitle}>Worth double-checking</h2>
          <ul className={styles.list}>
            {data.findings.map((f) => (
              <li key={f.key}>{f.sentence}</li>
            ))}
          </ul>
        </section>
      )}
      {showPassed && passed.length > 0 && (
        <details className={styles.section}>
          <summary className={styles.muted}>Already passed</summary>
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
