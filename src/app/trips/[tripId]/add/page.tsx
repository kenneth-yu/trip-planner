import { randomUUID } from "node:crypto";
import Link from "next/link";
import { notFound } from "next/navigation";
import styles from "../../../ui/page.module.css";
import { loadTripPage } from "@/server/web";
import { listTripMembers } from "@/server/services/member-service";
import { ItemForm } from "@/app/ui/item-form/item-form";
import { addItem, placeHint } from "./actions";

export default async function AddPage({ params }: PageProps<"/trips/[tripId]/add">) {
  const { tripId } = await params;
  const { ctx, requester, view } = await loadTripPage(tripId);
  if (!view.permissions.canEdit) notFound();
  const members = (await listTripMembers(ctx, tripId, requester)).filter((m) => m.userId !== view.viewerUserId);
  return (
    <div className={styles.narrow}>
      <h2 className={styles.sectionTitle}>Add to trip</h2>
      <ItemForm
        tripId={tripId}
        travelers={view.travelers}
        members={members}
        action={addItem}
        hint={placeHint}
        canChangeSharing
        submission={randomUUID()}
        backHref={`/trips/${tripId}`}
      />
      <p className={styles.muted}>
        Have a calendar file? <Link href={`/trips/${tripId}/import`}>Import a calendar</Link>.
      </p>
    </div>
  );
}
