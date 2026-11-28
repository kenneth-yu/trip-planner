import { cookies } from "next/headers";
import { notFound } from "next/navigation";
import styles from "../../../../ui/page.module.css";
import { GoogleAuthorizationError, googleCalendarReader, type ListedCalendar } from "@/server/google/calendar-api";
import { IMPORT_CLOSED, IMPORT_CONNECT_PATH, importIsRateLimited, importPagePath } from "@/server/google/import-guard";
import { IMPORT_COOKIE, openImportToken } from "@/server/google/import-oauth";
import { loadTripPage } from "@/server/web";
import { ImportForm } from "./forms";

async function calendarsFor(token: string): Promise<ListedCalendar[] | null> {
  try {
    return await googleCalendarReader(async () => token).listCalendars();
  } catch (e) {
    if (e instanceof GoogleAuthorizationError) return null;
    throw e;
  }
}

export default async function GoogleImportPage({ params, searchParams }: PageProps<"/trips/[tripId]/import/google">) {
  const { tripId } = await params;
  const { consent } = await searchParams;
  const path = importPagePath(tripId);
  const { user, view } = await loadTripPage(tripId, path);
  if (!view.permissions.canEdit) notFound();
  if (!importIsRateLimited("GET", path)) {
    return (
      <div className={styles.narrow}>
        <h2 className={styles.sectionTitle}>Import from Google Calendar</h2>
        <p className={styles.muted}>{IMPORT_CLOSED}</p>
      </div>
    );
  }
  const token = openImportToken((await cookies()).get(IMPORT_COOKIE)?.value, user.id, tripId);
  const calendars = token ? await calendarsFor(token) : null;
  const starts = view.items.map((i) => i.start.at).sort();
  const ends = view.items.map((i) => i.end.at).sort();
  return (
    <div className={styles.narrow}>
      <h2 className={styles.sectionTitle}>Import from Google Calendar</h2>
      {calendars ? (
        <ImportForm tripId={tripId} calendars={calendars} from={(starts[0] ?? "").slice(0, 10)} to={(ends[ends.length - 1] ?? "").slice(0, 10)} />
      ) : (
        <>
          <p className={styles.muted}>This asks Google to let the app read your calendars once. Nothing is kept, and everything it finds waits in the inbox for you to review.</p>
          {consent === "declined" && <p role="status">Google calendar access was not granted.</p>}
          <a href={`${IMPORT_CONNECT_PATH}?trip=${tripId}`}>Connect Google Calendar</a>
        </>
      )}
    </div>
  );
}
