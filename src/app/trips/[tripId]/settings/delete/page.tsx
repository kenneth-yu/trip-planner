import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import pageStyles from "../../../../ui/page.module.css";
import styles from "../../../../account/account.module.css";
import { loadTripPage } from "@/server/web";
import { listTripMembers } from "@/server/services/member-service";
import { joinNames } from "../../../../account/confirm";
import { DeleteTripForm } from "./delete-trip-form";

export const metadata: Metadata = { title: "Delete trip", robots: { index: false, follow: false } };

export default async function DeleteTripPage({ params }: PageProps<"/trips/[tripId]/settings/delete">) {
  const { tripId } = await params;
  const { ctx, requester, view } = await loadTripPage(tripId);
  if (view.permissions.role !== "owner") notFound();
  const others = (await listTripMembers(ctx, tripId, requester)).filter((m) => m.role !== "owner").map((m) => m.name);
  return (
    <div className={pageStyles.narrow}>
      <p>
        <Link href={`/trips/${tripId}`} className={styles.back}>
          Back to the trip
        </Link>
      </p>
      <h2 className={pageStyles.title}>Delete {view.trip.name}</h2>
      <p>
        This deletes the trip for everyone on it: every flight, stay and plan, their codes and seats, the deadlines, the inbox, invites and the view link. It cannot be
        undone.
      </p>
      {others.length > 0 && (
        <p>
          {joinNames(others)} {others.length === 1 ? "loses" : "lose"} access right away.
        </p>
      )}
      <p className={pageStyles.muted}>If anyone mirrors this trip to Google Calendar, that calendar is deleted from their Google account too.</p>
      <DeleteTripForm tripId={tripId} tripName={view.trip.name} />
    </div>
  );
}
