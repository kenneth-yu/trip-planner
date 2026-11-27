import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import pageStyles from "../../../ui/page.module.css";
import styles from "./settings.module.css";
import { loadTripPage } from "@/server/web";
import { getTravelerSettings, type TravelerSettings } from "@/server/services/traveler-service";
import { tripSpan } from "@/domain/timeline/trip-grid";
import { relationText } from "@/domain/travelers/names";
import { AccessDenied } from "@/domain/visibility/project";
import { NotFound } from "@/server/services/trip-service";
import { TravelerList, TripNameForm } from "./forms";

export const metadata: Metadata = { title: "Settings", robots: { index: false, follow: false } };

async function settingsOrNotFound(load: () => Promise<TravelerSettings>): Promise<TravelerSettings> {
  try {
    return await load();
  } catch (e) {
    if (e instanceof NotFound || e instanceof AccessDenied) notFound();
    throw e;
  }
}

export default async function SettingsPage({ params }: PageProps<"/trips/[tripId]/settings">) {
  const { tripId } = await params;
  const { ctx, requester, view } = await loadTripPage(tripId);
  if (!view.permissions.canEdit) notFound();
  const settings = await settingsOrNotFound(() => getTravelerSettings(ctx, tripId, requester));
  const span = tripSpan(view, ctx.now().getTime());
  return (
    <div className={pageStyles.narrow}>
      <h2 className={styles.title}>Settings</h2>
      <section className={pageStyles.section}>
        {settings.canRename ? (
          <TripNameForm tripId={tripId} name={settings.tripName} />
        ) : (
          <>
            <p className={pageStyles.muted}>Trip name</p>
            <p className={styles.value}>{settings.tripName}</p>
          </>
        )}
      </section>
      <section className={pageStyles.section}>
        {span ? (
          <>
            <p className={pageStyles.muted}>Dates</p>
            <p className={styles.value}>{span.dates}</p>
            <p className={pageStyles.muted}>Set by your bookings.</p>
          </>
        ) : (
          <p>No dates yet. They come from your bookings.</p>
        )}
      </section>
      <section className={pageStyles.section}>
        <h3 className={pageStyles.sectionTitle}>Travelers</h3>
        <TravelerList
          tripId={tripId}
          travelers={settings.travelers.map((x) => ({ id: x.id, name: x.name, secondary: relationText(x.relation), unlinked: x.relation.kind === "none", removable: x.removable }))}
          linkable={settings.linkable}
        />
      </section>
      {settings.canRename && (
        <p className={styles.delete}>
          <Link href={`/trips/${tripId}/settings/delete`}>Delete this trip</Link>
        </p>
      )}
    </div>
  );
}
