import { notFound } from "next/navigation";
import styles from "../../../../../ui/page.module.css";
import { loadTripPage } from "@/server/web";
import { viewerTravelerId } from "@/server/services/trip-service";
import { ItemForm } from "@/app/ui/item-form/item-form";
import { placeHint } from "../../../add/actions";
import { itemToFormValues } from "@/domain/import/item-form";
import { itemOf } from "../item-of";
import { itemHeading } from "../item-title";
import { editItem } from "./actions";

const FOCUS_TARGETS = ["code", "seat"] as const;

function focusFieldFor(focus: string | undefined, travelerIds: string[], viewerTraveler: string | null): string | null {
  const target = FOCUS_TARGETS.find((t) => t === focus);
  if (!target || travelerIds.length === 0) return null;
  const who = viewerTraveler && travelerIds.includes(viewerTraveler) ? viewerTraveler : travelerIds[0];
  if (target === "seat") return `seat:${who}`;
  return travelerIds.length === 1 ? "confirmationCode" : `code:${who}`;
}

export default async function EditItemPage({ params, searchParams }: PageProps<"/trips/[tripId]/items/[itemId]/edit">) {
  const { tripId, itemId } = await params;
  const { focus } = await searchParams;
  const { ctx, requester, view } = await loadTripPage(tripId, `/trips/${tripId}/items/${itemId}/edit`);
  const item = itemOf(view, itemId);
  if (!item || !view.permissions.canEdit) notFound();
  const travelers = view.travelers.filter((t) => item.travelerIds.includes(t.id));
  const traveler = await viewerTravelerId(ctx, tripId, requester);
  const heading = itemHeading(item);
  return (
    <div className={styles.narrow}>
      <h2 className={styles.sectionTitle}>Edit {heading}</h2>
      <ItemForm
        tripId={tripId}
        travelers={travelers}
        members={[]}
        initial={itemToFormValues(item, travelers)}
        action={editItem}
        hint={placeHint}
        canChangeSharing={false}
        submitLabel="Save changes"
        backLabel="Cancel"
        backHref={`/trips/${tripId}/items/${itemId}`}
        editing={{ itemId, title: heading, focusField: focusFieldFor(typeof focus === "string" ? focus : undefined, item.travelerIds, traveler) }}
      />
    </div>
  );
}
