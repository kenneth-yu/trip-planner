import Link from "next/link";
import styles from "./phone.module.css";
import type { UpNextEntry } from "@/domain/timeline/trip-grid";
import type { Attention } from "@/server/attention";

export function UpNext({ entries, attention, tripId }: { entries: UpNextEntry[]; attention: Attention; tripId: string }) {
  const soon = attention.deadlines.filter((d) => !d.passed && d.warning);
  const checks = attention.findings.length;
  return (
    <section className={styles.upNext}>
      {attention.pending > 0 && (
        <Link className={styles.alert} href={`/trips/${tripId}/inbox`}>
          {attention.pending === 1 ? "1 new item to look over" : `${attention.pending} new items to look over`}
          <small>Nothing is added until you say so.</small>
        </Link>
      )}
      {(soon.length > 0 || checks > 0) && (
        <Link className={styles.alert} href={`/trips/${tripId}/deadlines`}>
          {soon.length > 0 ? soon[0].sentence : `${checks} thing${checks === 1 ? "" : "s"} worth a look`}
          <small>{soon.length > 1 ? `and ${soon.length - 1} more to decide soon` : soon.length === 1 && checks > 0 ? `and ${checks} thing${checks === 1 ? "" : "s"} worth a look` : "Tap to see"}</small>
        </Link>
      )}
      {entries.length > 0 && (
        <>
          <h2>Up next</h2>
          {entries.map((e) => (
            <a key={e.key} className={styles.next} href={`?day=${e.dayKey}`}>
              <b>{e.time}</b>
              <span>
                {e.title}
                <small>
                  {e.date}
                  {e.place ? `, ${e.place}` : ""} · {e.inHowLong}
                </small>
              </span>
            </a>
          ))}
        </>
      )}
    </section>
  );
}
