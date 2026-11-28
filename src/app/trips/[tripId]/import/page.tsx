import type { Metadata } from "next";
import { notFound } from "next/navigation";
import styles from "../../../ui/page.module.css";
import { loadTripPage } from "@/server/web";
import { urlImportAvailable } from "@/server/import/ics-import";
import { defaultRange } from "@/domain/import/date-range";
import { toLocal } from "@/domain/time/format";
import { ImportForm, ProblemAlert } from "./import-form";
import { problemFromQuery, problemText } from "./ics/problems";

export const metadata: Metadata = { title: "Import bookings", robots: { index: false, follow: false } };

export default async function ImportPage({ params, searchParams }: PageProps<"/trips/[tripId]/import">) {
  const { tripId } = await params;
  const query = Object.fromEntries(Object.entries(await searchParams).map(([k, v]) => [k, Array.isArray(v) ? v[0] : v]));
  const problem = problemFromQuery(query);
  const { view } = await loadTripPage(tripId);
  if (!view.permissions.canEdit) notFound();
  const defaults = defaultRange(
    view.items.map((i) => toLocal(i.start).toISODate()),
    view.items.map((i) => toLocal(i.end).toISODate()),
  );
  const action = `/trips/${tripId}/import/ics`;
  return (
    <div className={styles.narrow}>
      <h2 className={styles.sectionTitle}>Import bookings</h2>
      <p>Everything you import waits in your review inbox. Nothing is added to the trip until you say so.</p>
      {problem && <ProblemAlert text={problemText(problem)} />}
      <section className={styles.section}>
        <ImportForm action={action} kind="file" defaults={defaults} />
      </section>
      {urlImportAvailable() && (
        <section className={styles.section}>
          <ImportForm action={action} kind="link" defaults={defaults} />
        </section>
      )}
    </div>
  );
}
