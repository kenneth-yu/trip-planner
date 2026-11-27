import Link from "next/link";
import { notFound } from "next/navigation";
import styles from "../../../../ui/page.module.css";
import { loadTripPage } from "@/server/web";
import { ItemDetails } from "./item-details";
import { formatDayHeader, localDateKey, toLocal } from "@/domain/time/format";
import { itemOf } from "./item-of";

export default async function ItemPage({ params }: PageProps<"/trips/[tripId]/items/[itemId]">) {
  const { tripId, itemId } = await params;
  const { view, ctx, user } = await loadTripPage(tripId, `/trips/${tripId}/items/${itemId}`);
  const item = itemOf(view, itemId);
  if (!item) notFound();
  return (
    <div className={styles.narrow}>
      <p className={styles.muted}>
        <Link href={`/trips/${tripId}?day=${localDateKey(item.start)}`}>Back to {formatDayHeader(toLocal(item.start))}</Link>
      </p>
      <ItemDetails view={view} item={item} nowMs={ctx.now().getTime()} viewerName={user.name} />
    </div>
  );
}
