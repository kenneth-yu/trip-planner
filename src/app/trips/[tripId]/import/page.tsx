import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";
import styles from "../../../ui/page.module.css";
import { loadTripPage } from "@/server/web";
import { urlImportAvailable } from "@/server/import/ics-import";
import { PROBLEM_TEXT, ProblemCode } from "./ics/problems";

export const metadata: Metadata = { title: "Import a calendar", robots: { index: false, follow: false } };

const Count = z.coerce.number().int().min(0).max(100000);
const Query = z.object({
  problem: ProblemCode.optional().catch(undefined),
  done: Count.optional().catch(undefined),
  skipped: Count.optional().catch(undefined),
  repeating: Count.optional().catch(undefined),
});

function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

export default async function ImportPage({ params, searchParams }: PageProps<"/trips/[tripId]/import">) {
  const { tripId } = await params;
  const query = Query.parse(Object.fromEntries(Object.entries(await searchParams).map(([k, v]) => [k, Array.isArray(v) ? v[0] : v])));
  const { view } = await loadTripPage(tripId);
  if (!view.permissions.canEdit) notFound();
  const action = `/trips/${tripId}/import/ics`;
  return (
    <div className={styles.narrow}>
      <h2 className={styles.sectionTitle}>Import a calendar</h2>
      {query.problem && (
        <p role="alert" className={styles.warning}>
          {PROBLEM_TEXT[query.problem]}
        </p>
      )}
      {query.done !== undefined && (
        <p role="status">
          Sent {plural(query.done, "item", "items")} to the <Link href={`/trips/${tripId}/inbox`}>review inbox</Link>.
          {query.skipped ? ` ${plural(query.skipped, "event was", "events were")} left out (cancelled, changed copies of repeating events, or with no readable time).` : ""}
          {query.repeating ? ` ${plural(query.repeating, "repeating event was", "repeating events were")} added once.` : ""}
        </p>
      )}
      <section className={styles.section}>
        <h3 className={styles.sectionTitle}>From a file</h3>
        <form method="post" action={action} encType="multipart/form-data">
          <p>
            <label htmlFor="ics-file">Calendar file (.ics, up to 2 MB)</label>
          </p>
          <p>
            <input id="ics-file" type="file" name="file" accept=".ics,text/calendar" />
          </p>
          <button type="submit">Import file</button>
        </form>
      </section>
      {urlImportAvailable() && (
        <section className={styles.section}>
          <h3 className={styles.sectionTitle}>From a link</h3>
          <form method="post" action={action} encType="multipart/form-data">
            <p>
              <label htmlFor="ics-link">Calendar link (starts with https:// or webcal://)</label>
            </p>
            <p>
              <input id="ics-link" type="url" name="link" autoComplete="off" spellCheck={false} />
            </p>
            <button type="submit">Import link</button>
          </form>
          <p className={styles.muted}>The link is used once to fetch the calendar. It is not saved.</p>
        </section>
      )}
      <p className={styles.muted}>Everything imported goes to the review inbox first. Nothing is added to the trip until you approve it.</p>
    </div>
  );
}
