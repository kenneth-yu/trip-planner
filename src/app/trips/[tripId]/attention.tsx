import Link from "next/link";
import styles from "../../ui/page.module.css";
import { TRIP_PAGE_LIMIT, type Attention as AttentionData } from "@/server/attention";
import type { OpenCheck } from "@/server/services/check-service";
import type { DeadlineLine } from "@/domain/deadlines/deadlines";
import { CheckLine, ShowAgain } from "./deadlines/check-controls";

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

function InboxNotice({ data, tripId }: { data: AttentionData; tripId: string }) {
  if (data.pending === 0) return null;
  return (
    <Link className={styles.callout} href={`/trips/${tripId}/inbox`}>
      {data.pending === 1 ? "1 new item to look over" : `${data.pending} new items to look over`}
      <small>{sentFrom(data.pendingFrom)}. Nothing is added until you say so.</small>
    </Link>
  );
}

export function AttentionPanel({ data, tripId, checks }: { data: AttentionData; tripId: string; checks: OpenCheck[] }) {
  const upcoming = data.deadlines.filter((l) => !l.passed);
  const soon = upcoming.filter((l) => l.warning);
  const later = upcoming.filter((l) => !l.warning);
  const shownChecks = checks.slice(0, Math.max(0, TRIP_PAGE_LIMIT - soon.length));
  const more = later.length + checks.length - shownChecks.length + Math.max(0, soon.length - TRIP_PAGE_LIMIT);
  return (
    <>
      <InboxNotice data={data} tripId={tripId} />
      {(soon.length > 0 || shownChecks.length > 0) && (
        <section className={styles.panel}>
          {soon.length > 0 && (
            <ul className={styles.list}>
              {soon.slice(0, TRIP_PAGE_LIMIT).map((l) => (
                <li key={l.id}>
                  <div className={styles.warning}>{l.sentence}</div>
                  <div className={styles.muted}>{l.exact}</div>
                </li>
              ))}
            </ul>
          )}
          {shownChecks.length > 0 && (
            <>
              <h2 className={styles.sectionTitle}>Worth a look</h2>
              <ul className={styles.list}>
                {shownChecks.map((f) => (
                  <li key={f.anchor}>
                    <Link className={styles.panelLink} href={`/trips/${tripId}/deadlines#check-${f.anchor}`}>
                      {f.sentence}
                    </Link>
                  </li>
                ))}
              </ul>
            </>
          )}
          {more > 0 && (
            <p className={styles.muted}>
              <Link href={`/trips/${tripId}/deadlines`}>See {more} more</Link>
            </p>
          )}
        </section>
      )}
    </>
  );
}

export function AttentionPage({ data, tripId }: { data: AttentionData; tripId: string }) {
  const upcoming = data.deadlines.filter((l) => !l.passed);
  const soon = upcoming.filter((l) => l.warning);
  const later = upcoming.filter((l) => !l.warning);
  const passed = data.deadlines.filter((l) => l.passed);
  return (
    <>
      <InboxNotice data={data} tripId={tripId} />
      <Deadlines title="Decide in the next few days" lines={soon} />
      <Deadlines title={soon.length ? "Later" : "Deadlines"} lines={later} />
      {data.findings.length > 0 && (
        <section className={styles.section}>
          <h2 className={styles.sectionTitle}>Worth a look</h2>
          <ul className={styles.list}>
            {data.findings.map((f) => (
              <li key={f.anchor} id={`check-${f.anchor}`} className={styles.checkLine}>
                <CheckLine tripId={tripId} anchor={f.anchor} sentence={f.sentence} canEdit={data.canEdit} />
              </li>
            ))}
          </ul>
        </section>
      )}
      {passed.length > 0 && (
        <details className={styles.section}>
          <summary className={`${styles.muted} ${styles.summaryRow}`}>Already passed</summary>
          <ul className={styles.list}>
            {passed.map((l) => (
              <li key={l.id} className={styles.muted}>
                {l.sentence}
              </li>
            ))}
          </ul>
        </details>
      )}
      {data.dismissed.length > 0 && (
        <details className={styles.section}>
          <summary className={`${styles.muted} ${styles.summaryRow}`}>Marked as fine ({data.dismissed.length})</summary>
          <ul className={styles.list}>
            {data.dismissed.map((d) => (
              <li key={d.anchor}>
                <div className={styles.muted}>{d.sentence}</div>
                <div className={styles.muted}>{d.by ? `${d.by}, ${d.on}` : `Marked ${d.on}`}</div>
                {data.canEdit && <ShowAgain tripId={tripId} anchor={d.anchor} />}
              </li>
            ))}
          </ul>
        </details>
      )}
    </>
  );
}
