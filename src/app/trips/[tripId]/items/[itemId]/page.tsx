import Link from "next/link";
import { notFound } from "next/navigation";
import styles from "../../../../ui/page.module.css";
import itemStyles from "./item.module.css";
import { loadTripPage } from "@/server/web";
import { viewerTravelerId } from "@/server/services/trip-service";
import { ItemDetails } from "./item-details";
import { ItemActions } from "./item-actions";
import { deleteItem } from "./actions";
import { itemHeading } from "./item-title";
import { FlashStatus } from "@/app/ui/item-form/flash-status";
import { formatDayHeader, localDateKey, toLocal } from "@/domain/time/format";
import { itemOf } from "./item-of";
import { SmartFlashes } from "../../smart-row";
import { loadAttention } from "@/server/attention";
import { loadTipsForPage } from "@/server/services/smarts-service";
import { arrangeRows, checkSources, tipSources } from "@/domain/smarts/rows";

export default async function ItemPage({ params }: PageProps<"/trips/[tripId]/items/[itemId]">) {
  const { tripId, itemId } = await params;
  const { view, ctx, requester } = await loadTripPage(tripId, `/trips/${tripId}/items/${itemId}`);
  const item = itemOf(view, itemId);
  if (!item) notFound();
  const travelerId = await viewerTravelerId(ctx, tripId, requester);
  const attention = await loadAttention(ctx, view, requester);
  const shownTips = await loadTipsForPage(ctx, view, requester);
  const smart = { rows: arrangeRows([...checkSources(attention.findings), ...tipSources(shownTips.tips)]), showIntro: false };
  const heading = itemHeading(item);
  const shared = view.items.some((other) => other.id !== item.id && itemHeading(other) === heading);
  const promptName = shared ? `${heading} on ${formatDayHeader(toLocal(item.start))}` : heading;
  return (
    <div className={styles.narrow}>
      <p className={styles.muted}>
        <Link className={itemStyles.backLink} href={`/trips/${tripId}?day=${localDateKey(item.start)}`}>
          Back to {formatDayHeader(toLocal(item.start))}
        </Link>
      </p>
      <FlashStatus kind="saved" tripId={tripId} focusId="item-title" />
      <SmartFlashes tripId={tripId} />
      <ItemDetails view={view} item={item} nowMs={ctx.now().getTime()} viewerTravelerId={travelerId} smart={smart} />
      {view.permissions.canEdit && (
        <ItemActions tripId={tripId} itemId={itemId} heading={promptName} editHref={`/trips/${tripId}/items/${itemId}/edit`} remove={deleteItem} />
      )}
    </div>
  );
}
