import Link from "next/link";
import styles from "./phone.module.css";
import type { UpNextEntry } from "@/domain/timeline/trip-grid";
import { phoneAlert, type Attention } from "@/server/attention";
import type { OpenCheck } from "@/server/services/check-service";

const more = (n: number) => `and ${n} more`;

function Alert({ attention, checks, tripId }: { attention: Attention; checks: OpenCheck[]; tripId: string }) {
  const alert = phoneAlert(attention, checks);
  if (!alert) return null;
  const warn = alert.kind === "deadline";
  const className = `${styles.alert} ${warn ? styles.alertWarn : ""}`;
  const base = `/trips/${tripId}`;
  const main = alert.kind === "inbox" ? `${base}/inbox` : alert.anchor ? `${base}/deadlines#check-${alert.anchor}` : `${base}/deadlines`;
  const rest = alert.moreIsInboxOnly ? `${base}/inbox` : `${base}/deadlines`;
  return (
    <div className={className}>
      <Link className={styles.alertLink} href={main}>
        {alert.kind === "check" && <small>Worth a look</small>}
        {alert.kind === "inbox" ? (attention.pending === 1 ? "1 new item to look over" : `${attention.pending} new items to look over`) : alert.sentence}
        {alert.kind === "inbox" && <small>Nothing is added until you say so.</small>}
      </Link>
      {alert.more > 0 && (
        <small>
          <Link href={rest}>{more(alert.more)}</Link>
        </small>
      )}
    </div>
  );
}

export function UpNext({ entries, attention, checks, tripId }: { entries: UpNextEntry[]; attention: Attention; checks: OpenCheck[]; tripId: string }) {
  return (
    <section className={styles.upNext}>
      <Alert attention={attention} checks={checks} tripId={tripId} />
      {entries.length > 0 && (
        <>
          <h2>Up next</h2>
          {entries.map((e) => (
            <Link key={e.key} className={styles.next} href={`/trips/${tripId}/items/${e.itemId}`}>
              <b>{e.time}</b>
              <span>
                {e.title}
                <small>
                  {e.date}
                  {e.place ? `, ${e.place}` : ""} · {e.inHowLong}
                </small>
              </span>
            </Link>
          ))}
        </>
      )}
    </section>
  );
}
