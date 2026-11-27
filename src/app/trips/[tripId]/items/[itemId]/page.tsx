import Link from "next/link";
import { notFound } from "next/navigation";
import styles from "../../../../ui/page.module.css";
import { loadTripPage } from "@/server/web";
import { ItemDetails } from "./item-details";
import { itemOf } from "./item-of";

export default async function ItemPage({ params }: PageProps<"/trips/[tripId]/items/[itemId]">) {
  const { tripId, itemId } = await params;
  const { view, ctx } = await loadTripPage(tripId, `/trips/${tripId}/items/${itemId}`);
  const item = itemOf(view, itemId);
  if (!item) notFound();
  return (
    <div className={styles.narrow}>
      <p className={styles.muted}>
        <Link href={`/trips/${tripId}`}>Back to the trip</Link>
      </p>
      <ItemDetails view={view} item={item} nowMs={ctx.now().getTime()} />
    </div>
  );
}
