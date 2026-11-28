import Link from "next/link";
import styles from "./where-sleep.module.css";
import formStyles from "@/app/ui/item-form/item-form.module.css";
import type { SleepPlan, SleepSummary } from "@/domain/timeline/sleep-plan";
import { WhyHint } from "./why-hint";

export function addStayHref(tripId: string, city: string, checkIn: string, checkOut: string): string {
  return `/trips/${tripId}/add?${new URLSearchParams({ type: "stay", city, checkIn, checkOut, booked: "no" }).toString()}`;
}

function Summary({ summary, tripId, canEdit }: { summary: SleepSummary; tripId: string; canEdit: boolean }) {
  const several = summary.stretchLines.length > 1;
  return (
    <div className={styles.summary}>
      <h2 className={styles.heading}>{summary.heading}</h2>
      {summary.stretchLines.map((l) => (
        <p key={`${l.city}-${l.checkIn}`} className={styles.line}>
          {l.line}
          {several && canEdit && (
            <>
              {" "}
              <Link className={styles.quiet} href={addStayHref(tripId, l.city, l.checkIn, l.checkOut)}>
                Add a stay
              </Link>
            </>
          )}
        </p>
      ))}
      {summary.hints.map((h) => (
        <WhyHint key={h.text} hint={h.text} why={h.why} />
      ))}
      {summary.moreHints > 0 && <p className={styles.hint}>and {summary.moreHints} more</p>}
      {!several && canEdit && (
        <p>
          <Link className={formStyles.primaryLink} href={addStayHref(tripId, summary.stretchLines[0].city, summary.stretchLines[0].checkIn, summary.stretchLines[0].checkOut)}>
            Add a stay for these nights
          </Link>
        </p>
      )}
    </div>
  );
}

function Blocks({ plan }: { plan: SleepPlan }) {
  return (
    <>
      <ul className={styles.blocks}>
        {plan.stretches.map((s) => (
          <li key={s.checkIn + s.city}>
            <p className={styles.blockTitle}>{s.title}</p>
            <p className={styles.line}>{s.datesLine}</p>
            {s.arrivalLine && <p className={styles.hint}>{s.arrivalLine}</p>}
            {s.departureLine && <p className={styles.hint}>{s.departureLine}</p>}
            {s.warnings.map((w) => (
              <p key={w} className={styles.warning}>
                {w}
              </p>
            ))}
          </li>
        ))}
      </ul>
      {plan.summary?.nightNotes.map((n) => (
        <p key={n} className={styles.hint}>
          {n}
        </p>
      ))}
    </>
  );
}

export function WhereSleep({ plan, tripId, canEdit, folded }: { plan: SleepPlan; tripId: string; canEdit: boolean; folded: boolean }) {
  if (!plan.summary) return null;
  return (
    <section className={styles.panel} aria-label="Where you'll sleep">
      <Summary summary={plan.summary} tripId={tripId} canEdit={canEdit} />
      {folded ? (
        <details className={styles.detail}>
          <summary className={styles.detailSummary}>Night by night</summary>
          <Blocks plan={plan} />
        </details>
      ) : (
        <div className={styles.detail}>
          <h3 className={styles.detailTitle}>Night by night</h3>
          <Blocks plan={plan} />
        </div>
      )}
    </section>
  );
}
