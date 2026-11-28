import { and, eq } from "drizzle-orm";
import { cookies } from "next/headers";
import { notFound } from "next/navigation";
import { ZodError } from "zod";
import styles from "../../../../ui/page.module.css";
import local from "./google-import.module.css";
import { appUrl } from "@/server/app-context";
import * as t from "@/server/db/schema";
import { GoogleApiError, GoogleAuthorizationError, type ListedCalendar } from "@/server/google/calendar-api";
import { IMPORT_CLOSED, IMPORT_CONNECT_PATH, importIsRateLimited, importOAuthConfig, importPagePath, importReader } from "@/server/google/import-guard";
import { defaultImportRange } from "@/server/google/import";
import { IMPORT_COOKIE, IMPORT_SEEN_COOKIE, openImportHeld } from "@/server/google/import-oauth";
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
  declined: "Google Calendar was not connected, so nothing was imported.",
  expired: "That took a while, so Google's permission ran out. Continue to Google again.",
  failed: "Google did not answer. Try again in a few minutes.",
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
        <a className={local.back} href={`/trips/${tripId}/import`}>Back to Import bookings</a>
      </div>
    );
  }
  const jar = await cookies();
  const held = openImportHeld(jar.get(IMPORT_COOKIE)?.value, user.id, tripId);
  const ranOut = !held && jar.get(IMPORT_SEEN_COOKIE) !== undefined && typeof consent !== "string";
  const listing = await listingFor(held?.accessToken ?? null);
  const notice = typeof consent === "string" ? CONSENT_MESSAGES[consent] : undefined;
  if (listing.kind === "calendars") {
    const range = defaultImportRange(
      view.items.map((i) => i.start.at),
      view.items.map((i) => i.end.at),
      ctx.now(),
    );
    return (
      <div className={styles.narrow}>
        <h2 className={styles.sectionTitle}>Choose what to bring in</h2>
        {held?.email && <p className={styles.muted}>From {held.email}</p>}
        {listing.calendars.length === 0 ? <p className={styles.muted}>This Google account has no calendars to import from.</p> : <ImportForm tripId={tripId} calendars={listing.calendars} from={range.from} to={range.to} />}
      </div>
    );
  }
  const [mirror] = await ctx.db.select().from(t.calendarMirrors).where(and(eq(t.calendarMirrors.tripId, tripId), eq(t.calendarMirrors.userId, user.id), eq(t.calendarMirrors.enabled, true)));
  return (
    <div className={styles.narrow}>
      <h2 className={styles.sectionTitle}>Import from Google Calendar</h2>
      {notice && <p role="alert">{notice}</p>}
      {ranOut && <p role="alert">{CONSENT_MESSAGES.expired}</p>}
      {listing.kind === "unavailable" && (
        <>
          <p role="alert">Google did not answer. Try again in a few minutes.</p>
          <a href={path}>Try again</a>
        </>
      )}
      {listing.kind === "connect" && (
        <>
          <p className={styles.muted}>Google will ask to let Trip planner see your calendars. The app reads the calendars and dates you pick, once, and does not keep that permission.</p>
          <p className={styles.muted}>Everything comes into your review inbox first. Nothing is added until you say so.</p>
          {mirror && <p className={styles.muted}>This is separate from mirroring the trip to Google Calendar on the Connect page.</p>}
          <a className={local.continue} href={`${IMPORT_CONNECT_PATH}?trip=${tripId}`}>
            Continue to Google
          </a>
        </>
      )}
    </div>
  );
}
