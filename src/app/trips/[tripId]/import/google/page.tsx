import { cookies } from "next/headers";
import { notFound } from "next/navigation";
import { ZodError } from "zod";
import styles from "../../../../ui/page.module.css";
import { appUrl } from "@/server/app-context";
import { GoogleApiError, GoogleAuthorizationError, type ListedCalendar } from "@/server/google/calendar-api";
import { IMPORT_CLOSED, IMPORT_CONNECT_PATH, importIsRateLimited, importOAuthConfig, importPagePath, importReader } from "@/server/google/import-guard";
import { defaultImportRange } from "@/server/google/import";
import { IMPORT_COOKIE, openImportToken } from "@/server/google/import-oauth";
import { loadTripPage } from "@/server/web";
import { ImportForm } from "./forms";

type Listing = { kind: "calendars"; calendars: ListedCalendar[] } | { kind: "connect" } | { kind: "unavailable" };

async function listingFor(token: string | null): Promise<Listing> {
  if (!token) return { kind: "connect" };
  try {
    return { kind: "calendars", calendars: await (await importReader(token)).listCalendars() };
  } catch (e) {
    if (e instanceof GoogleAuthorizationError) return { kind: "connect" };
    if (e instanceof GoogleApiError || e instanceof ZodError) return { kind: "unavailable" };
    throw e;
  }
}

const CONSENT_MESSAGES: Record<string, string> = {
  declined: "Google calendar access was not granted.",
  expired: "That Google sign in expired or was already used. Connect again.",
  failed: "Google sign in did not finish. Try again.",
};

export default async function GoogleImportPage({ params, searchParams }: PageProps<"/trips/[tripId]/import/google">) {
  const { tripId } = await params;
  const { consent } = await searchParams;
  if (!importOAuthConfig(appUrl())) notFound();
  const path = importPagePath(tripId);
  const { ctx, user, view } = await loadTripPage(tripId, path);
  if (!view.permissions.canEdit) notFound();
  if (!importIsRateLimited("GET", path)) {
    return (
      <div className={styles.narrow}>
        <h2 className={styles.sectionTitle}>Import from Google Calendar</h2>
        <p className={styles.muted}>{IMPORT_CLOSED}</p>
      </div>
    );
  }
  const listing = await listingFor(openImportToken((await cookies()).get(IMPORT_COOKIE)?.value, user.id, tripId));
  const range = defaultImportRange(
    view.items.map((i) => i.start.at),
    view.items.map((i) => i.end.at),
    ctx.now(),
  );
  const notice = typeof consent === "string" ? CONSENT_MESSAGES[consent] : undefined;
  return (
    <div className={styles.narrow}>
      <h2 className={styles.sectionTitle}>Import from Google Calendar</h2>
      {notice && <p role="alert">{notice}</p>}
      {listing.kind === "calendars" && <ImportForm tripId={tripId} calendars={listing.calendars} from={range.from} to={range.to} />}
      {listing.kind === "unavailable" && (
        <>
          <p role="alert">Google did not answer. Try again in a minute.</p>
          <a href={path}>Try again</a>
        </>
      )}
      {listing.kind === "connect" && (
        <>
          <p className={styles.muted}>This asks Google to let the app read your calendars once. Nothing is kept, and everything it finds waits in the inbox for you to review.</p>
          <a href={`${IMPORT_CONNECT_PATH}?trip=${tripId}`}>Connect Google Calendar</a>
        </>
      )}
    </div>
  );
}
